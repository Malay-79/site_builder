import { Routes, Route,useLocation } from "react-router-dom";

import Navbar from "./components/Navbar";

import Home from "./pages/Home";
import Projects from "./pages/Projects";
import Pricing from "./pages/Pricing";
import MyProjects from "./pages/MyProjects";
import PreView from "./pages/Preview";
import Community from "./pages/Community";
import View from "./pages/View";
import { Toaster } from 'sonner'
import AuthPage from "./pages/auth/AuthPages";
import Settings from "./pages/Settings";
import Loading from "./pages/Loading";

const App = () => {
  const { pathname} = useLocation();
  const hideNavbar = pathname.startsWith('/projects/') && pathname !== '/projects' || pathname.startsWith('/view/') || pathname.startsWith('/preview/')

  return (
    <div className="min-h-screen bg-black">
    <Toaster />
      {!hideNavbar && <Navbar />}
      

      <Routes>
        <Route path="/" element={<Home />} />

        <Route path="/projects/:projectId" element={<Projects />}/>

        <Route path="/pricing" element={<Pricing />} />

        <Route path="/projects" element={<MyProjects />} />

        <Route path="/preview/:projectId" element={<PreView />}/>

        <Route path="/preview/:projectId/:versionId" element={<PreView />}/>

        <Route path="/community" element={<Community />}/>

        <Route path="/view/:projectId" element={<View />}/>

        <Route path="/auth/:pathname" element={<AuthPage/>}/>
        <Route path="/account/settings" element={<Settings/>}/>
        <Route path='/loading' element={<Loading/>}/>
      </Routes>
    </div>
  );
};

export default App;