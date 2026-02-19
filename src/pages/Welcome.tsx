import MatrixBackground from '../components/MatrixBackground';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

const WelcomePage = () => {
  const navigate = useNavigate();

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden overflow-y-auto font-space-grotesk">
      <MatrixBackground />
      <div className="welcome-ambient pointer-events-none absolute inset-0 z-0" />

      <main className="relative z-20 flex min-h-[100dvh] w-full items-center justify-center px-3 pb-6 pt-16 sm:px-4 md:px-8 md:pt-20">
        <div className="hacker-panel relative z-10 mx-auto w-full max-w-lg rounded-xl border border-green-500/50 px-4 py-4 backdrop-blur-xl sm:px-5 sm:py-5 md:px-6 md:py-6">
          <h1 className="hacker-title welcome-title mx-auto max-w-[500px] text-center text-[28px] font-extrabold leading-[1.08] tracking-tight text-green-400 text-shadow-neon md:text-[46px]">
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
