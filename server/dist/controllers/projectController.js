import prisma from '../lib/prisma.js';
import { createChatCompletionWithRetry } from '../configs/openai.js';
export const extractHTML = (content) => {
    if (!content)
        return "";
    // Try to find the HTML document
    const htmlStart = content.search(/<!DOCTYPE\s+html|<html/i);
    const htmlEnd = content.lastIndexOf("</html>");
    if (htmlStart !== -1 && htmlEnd !== -1) {
        return content.substring(htmlStart, htmlEnd + 7).trim();
    }
    // Fallback: strip markdown code blocks
    return content
        .replace(/```[a-z]*\n?/gi, '')
        .replace(/```$/g, '')
        .trim();
};
//controller function to make revision
export const makeRevision = async (req, res) => {
    const userId = req.userId;
    try {
        const projectId = req.params.projectId;
        const { message } = req.body;
        const user = await prisma.user.findUnique({
            where: { id: userId }
        });
        if (!userId || !user) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        if (user.credits < 2) {
            return res.status(403).json({ message: 'add more credits to make changes' });
        }
        if (!message || message.trim() == '') {
            return res.status(400).json({ message: 'Please enter a valid prompt' });
        }
        const currentProject = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId },
            include: { versions: true }
        });
        if (!currentProject) {
            return res.status(401).json({ message: 'Project not found' });
        }
        await prisma.conversation.create({
            data: {
                role: 'user',
                content: message,
                projectId
            }
        });
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { decrement: 2 } }
        });
        //enhance user prompt
        console.log("AI prompt enhancement for revision request started.");
        console.log("Model requested:", process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2');
        console.log("Revision prompt payload:", message);
        const promptEnhanceResponse = await createChatCompletionWithRetry({
            model: process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2',
            max_tokens: 1500,
            messages: [
                {
                    role: 'system',
                    content: `
                    You are a prompt enhancement specialist. The user wants to make changes to their website. Enhance their request to be more specific and actionable for a web developer.

                    Enhance this by:
                    1. Being specific about what elements to change
                    2. Mentioning design details (colors, spacing, sizes)
                    3. Clarifying the desired outcome
                    4. Using clear technical terms

                    Return ONLY the enhanced request, nothing else. Keep it concise (1-2 sentences).`
                },
                {
                    role: 'user',
                    content: `user's request: "${message}"`
                }
            ]
        });
        console.log("AI prompt enhancement for revision response received:", JSON.stringify(promptEnhanceResponse, null, 2));
        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content;
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I've enhanced your prompt to: "${enhancedPrompt}"`,
                projectId
            }
        });
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'Now making changes to your website...',
                projectId
            }
        });
        //generate website code 
        console.log("AI code generation for revision request started.");
        console.log("Model requested:", process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2');
        console.log("Enhanced prompt revision payload:", enhancedPrompt);
        // Calculate max_tokens dynamically: scale based on prompt length, capped between 1500 and 2500
        const promptLength = (enhancedPrompt || '').length;
        const dynamicMaxTokens = Math.min(2500, Math.max(1500, 1500 + Math.floor(promptLength * 0.5)));
        console.log(`[Dynamic Token Allocation] Calculated max_tokens: ${dynamicMaxTokens} for prompt of length ${promptLength}`);
        const codeGenerationResponse = await createChatCompletionWithRetry({
            model: process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2',
            max_tokens: dynamicMaxTokens,
            messages: [
                {
                    role: 'system',
                    content: `
                    You are an expert web developer. 

                        CRITICAL REQUIREMENTS:
                        - Return ONLY the complete updated HTML code with the requested changes.
                        - Use Tailwind CSS for ALL styling (NO custom CSS).
                        - Use Tailwind utility classes for all styling changes.
                        - Include all JavaScript in <script> tags before closing </body>
                        - Make sure it's a complete, standalone HTML document with Tailwind CSS
                        - Return the HTML Code Only, nothing else

                        Apply the requested changes while maintaining the Tailwind CSS styling approach.`
                },
                {
                    role: 'user',
                    content: `Here is the current website code: "${currentProject.current_code}" The user wants this change: "${enhancedPrompt}"`
                }
            ]
        });
        console.log("=== RAW AI RESPONSE (REVISION) ===");
        console.log(codeGenerationResponse?.choices?.[0]?.message?.content || "(null/undefined)");
        const rawCode = codeGenerationResponse?.choices?.[0]?.message?.content || '';
        const processedCode = extractHTML(rawCode);
        console.log("=== PROCESSED/PARSING OUTPUT (REVISION) ===");
        console.log(processedCode);
        if (!processedCode) {
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: "Unable to generate the code, please try again",
                    projectId
                }
            });
            await prisma.user.update({
                where: { id: userId },
                data: { credits: { increment: 2 } }
            });
            return;
        }
        const version = await prisma.version.create({
            data: {
                code: processedCode,
                description: 'changes made',
                projectId
            }
        });
        console.log("=== DATABASE-STORED CONTENT (REVISION VERSION ID: " + version.id + ") ===");
        console.log(version.code);
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've made the changes to your website! You can now preview it",
                projectId
            }
        });
        const updatedProject = await prisma.websiteProject.update({
            where: { id: projectId },
            data: {
                current_code: processedCode,
                current_version_index: version.id
            }
        });
        console.log("=== DATABASE-STORED CONTENT (REVISION PROJECT ID: " + updatedProject.id + ") ===");
        console.log(updatedProject.current_code);
        res.json({ message: 'Changes made successfully' });
    }
    catch (error) {
        await prisma.user.update({
            where: { id: userId },
            data: { credits: { increment: 2 } }
        });
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
//controller function to rollback to a specific version 
export const rollbackToVersion = async (req, res) => {
    try {
        const userId = req.userId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const projectId = req.params.projectId;
        const versionId = req.params.versionId;
        const project = await prisma.websiteProject.findUnique({
            where: {
                id: projectId,
                userId
            },
            include: {
                versions: true
            }
        });
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        const version = project.versions.find((version) => version.id === versionId);
        if (!version) {
            return res.status(404).json({ message: 'Version not found' });
        }
        await prisma.websiteProject.update({
            where: { id: projectId, userId },
            data: {
                current_code: version.code,
                current_version_index: version.id
            }
        });
        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've rolled back your website to selected version. You can now preview it",
                projectId
            }
        });
        res.json({ message: 'Version rolled back' });
    }
    catch (error) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
//controller function to delete a project
export const deleteProject = async (req, res) => {
    try {
        const userId = req.userId;
        const projectId = req.params.projectId;
        await prisma.websiteProject.delete({
            where: { id: projectId, userId },
        });
        res.json({ message: 'Project deleted successfully' });
    }
    catch (error) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
//controller for getting project code for preview
export const getProjectPreview = async (req, res) => {
    try {
        const userId = req.userId;
        const projectId = req.params.projectId;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        const project = await prisma.websiteProject.findFirst({
            where: { id: projectId, userId },
            include: { versions: true }
        });
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        res.json({ project });
    }
    catch (error) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
//get published projects
export const getPublishedProjects = async (req, res) => {
    try {
        const projects = await prisma.websiteProject.findMany({
            where: { isPublished: true },
            include: { user: true }
        });
        res.json({ projects });
    }
    catch (error) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
//get a single project by id
export const getProjectById = async (req, res) => {
    try {
        const projectId = req.params.projectId;
        const project = await prisma.websiteProject.findFirst({
            where: { id: projectId },
        });
        if (!project || project.isPublished === false || !project?.current_code) {
            return res.status(404).json({ message: 'Project not found' });
        }
        res.json({ code: project.current_code });
    }
    catch (error) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
//controller to save project code
export const saveProjectCode = async (req, res) => {
    try {
        const userId = req.userId;
        const projectId = req.params.projectId;
        const { code } = req.body;
        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }
        if (!code) {
            return res.status(400).json({ message: 'code is required' });
        }
        const project = await prisma.websiteProject.findUnique({
            where: { id: projectId, userId },
        });
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }
        await prisma.websiteProject.update({
            where: { id: projectId },
            data: { current_code: code, current_version_index: '' }
        });
        res.json({ message: 'Project saved successfully' });
    }
    catch (error) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
};
