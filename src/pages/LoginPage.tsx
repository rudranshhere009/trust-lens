import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MatrixBackground from '../components/MatrixBackground';
import { Button } from '@/components/ui/button';
import VisualBubbles from '@/components/VisualBubbles';


import Login from '@/components/Login'; // Assuming Login component will be reused for the form

const LoginPage = () => {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState('');

  const handleLoginSuccess = (profile: {
    name: string;
    email: string;
    photoUrl: string;
    faceVerified: boolean;
  }) => {
    localStorage.setItem('userProfile', JSON.stringify(profile));
    navigate('/app');
  };

  const handleLoginError = (message: string) => {
    setErrorMessage(message);
  };

  return (
        <div className="relative flex min-h-[100dvh] flex-col items-center justify-center overflow-x-hidden overflow-y-auto font-space-grotesk bg-black">
      <MatrixBackground />
      <div className="welcome-ambient pointer-events-none absolute inset-0 z-0" />
      <VisualBubbles />
      
      {/* Header - Sleek and minimal */}
      <header className="absolute top-0 left-0 right-0 z-30 p-4 md:p-6 bg-transparent animate-slide-in-down">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <img src="/favicon.ico" alt="TrustLens Logo" className="h-8 w-8" />
            <span className="text-2xl font-bold text-green-400 tracking-wider">TrustLens</span>
          </div>
        </div>
      </header>

      {/* Centered Content - Login Form */}
      <main className="relative z-20 flex w-full flex-col items-center justify-center text-center text-white p-4">
        <div data-bubble-obstacle className="relative z-10 max-w-md mx-auto rounded-xl bg-black/10 p-8 shadow-2xl shadow-green-500/30 backdrop-blur-xl border border-green-500/50 animate-scale-in animate-delay-300">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-shadow-neon animate-glitch animate-fade-in-down animate-delay-100 text-green-400 mb-6">
            Welcome Back
          </h1>
          {errorMessage && (
            <p className="text-red-500 mb-4">{errorMessage}</p>
          )}
          <Login onLoginSuccess={handleLoginSuccess} onLoginError={handleLoginError} />
          <p className="mt-4 text-gray-400">
            Don't have an account?{' '}
            <Link to="/signup" className="text-green-400 hover:underline">
              Sign Up
            </Link>
          </p>
          <p className="mt-2 text-gray-400">
            <Link to="/" className="text-green-400 hover:underline">
              Back to Welcome
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default LoginPage;
