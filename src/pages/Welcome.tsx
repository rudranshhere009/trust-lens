import MatrixBackground from '../components/MatrixBackground';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import VisualBubbles from '@/components/VisualBubbles';

const WelcomePage = () => {
  const navigate = useNavigate();

  return (
    <div className="relative h-[100dvh] w-screen overflow-hidden font-space-grotesk">
      <MatrixBackground />
      <div className="welcome-ambient pointer-events-none absolute inset-0 z-0" />
      <VisualBubbles />

      <header className="absolute left-0 top-0 z-30 px-3 py-3 md:px-5 md:py-4">
        <div className="flex items-center space-x-3">
          <img src="/favicon.ico" alt="TrustLens Logo" className="h-8 w-8 animate-slide-in-left animate-delay-200" />
          <span className="text-2xl font-bold tracking-wider text-green-400 animate-slide-in-left animate-delay-300">
            TrustLens
          </span>
        </div>
      </header>

      <main className="relative z-20 flex h-full items-center justify-center px-4 pb-6 pt-16 md:px-8 md:pt-20">
        <div data-bubble-obstacle className="relative z-10 mx-auto w-full max-w-lg rounded-xl border border-green-500/50 bg-black/20 px-4 py-4 shadow-2xl shadow-green-500/20 backdrop-blur-xl sm:px-5 sm:py-5 md:px-6 md:py-6">
          <h1 className="title-shaky mx-auto max-w-[500px] text-center text-[28px] font-extrabold leading-[1.08] tracking-tight text-green-400 text-shadow-neon md:text-[46px]">
            <span className="block">Uncover Truth</span>
            <span className="block">Navigate Justice</span>
          </h1>

          <p className="mx-auto mt-3 max-w-[500px] text-center text-xs leading-relaxed text-gray-200 md:text-sm">
            Welcome to TrustLens, your advanced AI co-pilot designed to cut through the noise of legal documents and combat misinformation.
            Analyze complex contracts, verify sources with unparalleled accuracy, and empower yourself with crystal-clear insights.
            We're here to ensure you navigate the legal landscape with absolute confidence and clarity.
          </p>

          <p className="mx-auto mt-3 max-w-[500px] text-center text-[14px] text-green-300 md:text-[20px]">
            "Empowering clarity in a world of information"
          </p>

          <div className="mt-4 flex justify-center">
            <Button
              size="lg"
              onClick={() => navigate('/signup')}
              className="h-9 rounded-full bg-green-600 px-5 text-xs font-bold text-white shadow-lg shadow-green-500/50 transition-all duration-300 hover:scale-105 hover:bg-green-500"
            >
              Get Started
            </Button>
          </div>
        </div>
      </main>
    </div>
  );
};

export default WelcomePage;
