import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/ThemeProvider";
import WelcomePage from "./pages/Welcome";
import LoginPage from "./pages/LoginPage"; // Import LoginPage
import SignUpPage from "./pages/SignUpPage"; // Import SignUpPage
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import AuthWrapper from "@/components/AuthWrapper"; // Import AuthWrapper

const queryClient = new QueryClient();

const App = () => (
  <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <AuthWrapper> {/* Wrap Routes with AuthWrapper */}
            <Routes>
              <Route path="/" element={<WelcomePage />} />
              <Route path="/login" element={<LoginPage />} /> {/* Add Login Route */}
              <Route path="/signup" element={<SignUpPage />} /> {/* Add SignUp Route */}
              <Route path="/app" element={<Index />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthWrapper>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
