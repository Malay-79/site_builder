import {Request, Response} from 'express'
import prisma from '../lib/prisma.js';
import openai, { createChatCompletionWithRetry } from '../configs/openai.js';
import Stripe from 'stripe'

export const extractHTML = (content: string): string => {
  if (!content) return "";
  
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

// Get User Credits
export const getUserCredits = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: {id: userId}
        })

        res.json({credits: user?.credits})
    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to create New Project
export const createUserProject = async (req: Request, res: Response) => {
    const userId = req.userId;
    let projectId: string | undefined;
    try {
        const { initial_prompt } = req.body;

        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const user = await prisma.user.findUnique({
            where: {id: userId}
        })

        if(user && user.credits < 2){
            return res.status(403).json({ message: 'add credits to create more projects' });
        }

        // Create a new project
        const project = await prisma.websiteProject.create({
            data: {
                name: initial_prompt.length > 50 ? initial_prompt.substring(0, 47) + '...' : initial_prompt,
                initial_prompt,
                userId
            }
        })
        projectId = project.id;

        // Update User's Total Creation
        await prisma.user.update({
            where: {id: userId},
            data: {totalCreation: {increment: 1}}
        })

        await prisma.conversation.create({
            data: {
                role: 'user',
                content: initial_prompt,
                projectId: project.id
            }
        })

        await prisma.user.update({
            where: {id: userId},
            data: {credits: {decrement: 2}}
        })

        res.json({projectId: project.id})

        // Enhance user prompt
        console.log("AI prompt enhancement request started.");
        console.log("Model requested:", process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2');
        console.log("Initial prompt payload:", initial_prompt);
        const promptEnhanceResponse = await createChatCompletionWithRetry({
            model: process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2',
            max_tokens: 1500,
            messages: [
                {
                    role: 'system',
                    content: `
                    You are a prompt enhancement specialist. Take the user's website request and expand it into a detailed, comprehensive prompt that will help create the best possible website.

                    Enhance this prompt by:
                    1. Adding specific design details (layout, color scheme, typography)
                    2. Specifying key sections and features
                    3. Describing the user experience and interactions
                    4. Including modern web design best practices
                    5. Mentioning responsive design requirements
                    6. Adding any missing but important elements

                    Return ONLY the enhanced prompt, nothing else. Make it detailed but concise (2-3 paragraphs max).`
                },
                {
                    role: 'user',
                    content: initial_prompt
                }
            ]
        })

        console.log("AI prompt enhancement response received:", JSON.stringify(promptEnhanceResponse, null, 2));
        const enhancedPrompt = promptEnhanceResponse.choices[0].message.content;

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: `I've enhanced your prompt to: "${enhancedPrompt}"`,
                projectId: project.id
            }
        })

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: 'now generating your website...',
                projectId: project.id
            }
        })

        // Generate website code
        console.log("AI code generation request started.");
        console.log("Model requested:", process.env.AI_MODEL || 'kwaipilot/kat-coder-pro-v2');
        console.log("Enhanced prompt payload:", enhancedPrompt);
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
                     You are an expert web developer. Create a complete, production-ready, single-page website based on this request: "${enhancedPrompt}"

                    CRITICAL REQUIREMENTS:
                    - You MUST output valid HTML ONLY. 
                    - Use Tailwind CSS for ALL styling
                    - Include this EXACT script in the <head>: <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
                    - Use Tailwind utility classes extensively for styling, animations, and responsiveness
                    - Make it fully functional and interactive with JavaScript in <script> tag before closing </body>
                    - Use modern, beautiful design with great UX using Tailwind classes
                    - Make it responsive using Tailwind responsive classes (sm:, md:, lg:, xl:)
                    - Use Tailwind animations and transitions (animate-*, transition-*)
                    - Include all necessary meta tags
                    - Use Google Fonts CDN if needed for custom fonts
                    - Use placeholder images from https://placehold.co/600x400
                    - Use Tailwind gradient classes for beautiful backgrounds
                    - Make sure all buttons, cards, and components use Tailwind styling

                    CRITICAL HARD RULES:
                    1. You MUST put ALL output ONLY into message.content.
                    2. You MUST NOT place anything in "reasoning", "analysis", "reasoning_details", or any hidden fields.
                    3. You MUST NOT include internal thoughts, explanations, analysis, comments, or markdown.
                    4. Do NOT include markdown, explanations, notes, or code fences.

                    The HTML should be complete and ready to render as-is with Tailwind CSS.`
                },
                {
                    role: 'user',
                    content: enhancedPrompt || ''
                }
            ]
        })

        console.log("=== RAW AI RESPONSE ===");
        console.log(codeGenerationResponse?.choices?.[0]?.message?.content || "(null/undefined)");

        const rawCode = codeGenerationResponse?.choices?.[0]?.message?.content || '';
        const processedCode = extractHTML(rawCode);

        console.log("=== PROCESSED/PARSING OUTPUT ===");
        console.log(processedCode);

        if(!processedCode){
             await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: "Unable to generate the code, please try again",
                    projectId: project.id
                }
            })
            await prisma.user.update({
                where: {id: userId},
                data: {credits: {increment: 2}}
            })
            return;
        }

        // Create Version for the project
        const version = await prisma.version.create({
            data: {
                code: processedCode,
                description: 'Initial version',
                projectId: project.id
            }
        })

        console.log("=== DATABASE-STORED CONTENT (VERSION ID: " + version.id + ") ===");
        console.log(version.code);

        await prisma.conversation.create({
            data: {
                role: 'assistant',
                content: "I've created your website! You can now preview it and request any changes.",
                projectId: project.id
            }
        })

        const updatedProject = await prisma.websiteProject.update({
            where: {id: project.id},
            data: {
                current_code: processedCode,
                current_version_index: version.id
            }
        })

        console.log("=== DATABASE-STORED CONTENT (PROJECT ID: " + updatedProject.id + ") ===");
        console.log(updatedProject.current_code);

    } catch (error : any) {
        console.log('Error in createUserProject:', error);
        
        // Refund credits if the user was charged
        if (userId) {
            await prisma.user.update({
                where: {id: userId},
                data: {credits: {increment: 2}}
            }).catch(e => console.log('Failed to refund credits:', e));
        }

        // If the response was already sent (project created but AI failed),
        // store the error in conversation so the frontend polling picks it up
        if (res.headersSent && projectId) {
            await prisma.conversation.create({
                data: {
                    role: 'assistant',
                    content: `Error generating website: ${error.message}. Your credits have been refunded. Please try again.`,
                    projectId
                }
            }).catch(e => console.log('Failed to create error conversation:', e));
            return;
        }

        // Response hasn't been sent yet — send error response
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Get A Single User Project
export const getUserProject = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const projectId = req.params.projectId as string;

       const project = await prisma.websiteProject.findUnique({
        where: {id: projectId, userId},
        include: {
            conversation: {
                orderBy: {timestamp: 'asc'}
            },
            versions: {orderBy: {timestamp: 'asc'}}
        }
       })

        res.json({project})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Get All Users Projects
export const getUserProjects = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

       const projects = await prisma.websiteProject.findMany({
        where: {userId},
        orderBy: {updatedAt: 'desc'}
       })

        res.json({projects})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Toggle Project Publish
export const togglePublish = async (req: Request, res: Response) => {
    try {
        const userId = req.userId;
        if(!userId){
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const projectId = req.params.projectId as string;

        const project = await prisma.websiteProject.findUnique({
            where: {id: projectId, userId}
        })

        if(!project){
            return res.status(404).json({ message: 'Project not found' });
        }

        await prisma.websiteProject.update({
            where: {id: projectId},
            data: {isPublished: !project.isPublished}
        })
       
        res.json({message: project.isPublished ? 'Project Unpublished' : 'Project Published Successfully'})

    } catch (error : any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}

// Controller Function to Purchase Credits
export const purchaseCredits = async (req: Request, res: Response) => {
    try {
        interface Plan {
            credits: number;
            amount: number;
        }

        const plans = {
            basic: {credits: 100, amount: 5},
            pro: {credits: 400, amount: 19},
            enterprise: {credits: 1000, amount: 49},
        }

        const userId = req.userId;
        const {planId} = req.body as {planId: keyof typeof plans}
        const origin = req.headers.origin as string;

        const plan: Plan = plans[planId]

        if(!plan){
            return res.status(404).json({ message: 'Plan not found' });
        }

        const transaction = await prisma.transaction.create({
            data: {
                userId: userId!,
                planId: req.body.planId,
                amount: plan.amount,
                credits: plan.credits
            }
        })

        const stripeKey = process.env.STRIPE_SECRET_KEY as string;
        console.log(`🔑 Using Stripe key starting with: ${stripeKey.substring(0, 20)}...`);
        const stripe = new Stripe(stripeKey);

        const session = await stripe.checkout.sessions.create({
                success_url: `${origin}/loading`,
                cancel_url: `${origin}`,
                line_items: [
                    {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `AiSiteBuilder - ${plan.credits} credits`
                        },
                        unit_amount: Math.floor(transaction.amount) * 100
                    },
                    quantity: 1
                    },
                ],
                mode: 'payment',
                metadata: {
                    transactionId: transaction.id,
                    appId: 'ai-site-builder'
                },
                expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // Expires in 30 minutes
                });

        console.log(`✅ Checkout session created: ${session.id}`);
        console.log(`🔗 Session URL: ${session.url}`);
        res.json({payment_link: session.url})

    } catch (error: any) {
        console.log(error.code || error.message);
        res.status(500).json({ message: error.message });
    }
}