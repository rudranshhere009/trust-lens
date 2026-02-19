import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MatrixBackground from '../components/MatrixBackground';


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
        <div className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-x-hidden overflow-y-auto font-space-grotesk bg-black">
      <MatrixBackground />
      <div className="welcome-ambient pointer-events-none absolute inset-0 z-0" />
      
      {/* Centered Content - Login Form */}
      <main className="relative z-20 flex w-full flex-col items-center justify-center p-3 text-center text-white sm:p-4">
        <div className="hacker-panel relative z-10 mx-auto w-full max-w-md rounded-xl border border-green-500/50 p-6 backdrop-blur-xl animate-scale-in animate-delay-300 sm:p-8">
          <h1 className="hacker-title welcome-title text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-shadow-neon text-green-400 mb-6">
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
