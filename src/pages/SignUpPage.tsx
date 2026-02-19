import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import MatrixBackground from '../components/MatrixBackground';


import SignUp from '@/components/SignUp'; // Assuming SignUp component will be reused for the form

const SignUpPage = () => {
  const navigate = useNavigate();
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignUpSuccess = (_profile: {
    name: string;
    email: string;
    photoUrl: string;
    faceVerified: boolean;
  }) => {
    navigate('/login'); // Move to login after successful signup
  };

  const handleSignUpError = (message: string) => {
    setErrorMessage(message);
  };

  return (
        <div className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-x-hidden overflow-y-auto font-space-grotesk bg-black">
      <MatrixBackground />
      <div className="welcome-ambient pointer-events-none absolute inset-0 z-0" />
      
      {/* Centered Content - Sign Up Form */}
      <main className="relative z-20 flex w-full flex-col items-center justify-center p-3 text-center text-white sm:p-4">
        <div className="hacker-panel relative z-10 mx-auto w-full max-w-md rounded-xl border border-green-500/50 p-6 backdrop-blur-xl animate-scale-in animate-delay-300 sm:p-8">
          <h1 className="hacker-title welcome-title text-3xl md:text-4xl font-extrabold tracking-tight leading-tight text-shadow-neon text-green-400 mb-6">
            Join TrustLens
          </h1>
          {errorMessage && (
            <p className="text-red-500 mb-4">{errorMessage}</p>
          )}
          <SignUp onSignUpSuccess={handleSignUpSuccess} onSignUpError={handleSignUpError} />
          <p className="mt-4 text-gray-400">
            Already have an account?{' '}
            <Link to="/login" className="text-green-400 hover:underline">
              Login
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

export default SignUpPage;
