import React, { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import FaceCapture from './FaceCapture';
import { saveFaceProfile } from '@/utils/faceUtils';

interface SignUpProps {
  onSignUpSuccess: (profile: {
    name: string;
    email: string;
    photoUrl: string;
    faceVerified: boolean;
  }) => void;
  onSignUpError: (message: string) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_CLASS =
  'bg-black/70 border-green-500/50 text-green-100 placeholder:text-green-300/45 caret-green-300 focus-visible:ring-green-500 focus-visible:ring-offset-0';

const getPasswordStrength = (value: string): 'Low' | 'Medium' | 'Strong' => {
  let score = 0;
  if (value.length >= 8) score += 1;
  if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;

  if (score <= 1) return 'Low';
  if (score <= 3) return 'Medium';
  return 'Strong';
};

const strengthColorMap: Record<'Low' | 'Medium' | 'Strong', string> = {
  Low: 'text-red-400',
  Medium: 'text-yellow-300',
  Strong: 'text-green-300',
};

const SignUp: React.FC<SignUpProps> = ({ onSignUpSuccess, onSignUpError }) => {
  const [step, setStep] = useState(1); // 1: Basic Info, 2: Face Capture
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const passwordStrength = useMemo(() => getPasswordStrength(password), [password]);

  const handleStep1Submit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name || !email || !password || !confirmPassword) {
      onSignUpError('Please fill in all required fields.');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      onSignUpError('Please enter a valid email address.');
      return;
    }

    if (password.length < 8) {
      onSignUpError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      onSignUpError('Passwords do not match.');
      return;
    }

    const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
    if (storedUsers.some((user: any) => user.email === email)) {
      onSignUpError('An account with this email already exists.');
      return;
    }

    setStep(2);
  };

  const handleFaceCaptureComplete = (descriptors: Float32Array[]) => {
    saveFaceProfile(email, descriptors);

    const newUser = {
      email,
      password,
      profile: {
        name,
        email,
        photoUrl: '',
        faceVerified: true,
      },
    };

    const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
    storedUsers.push(newUser);
    localStorage.setItem('users', JSON.stringify(storedUsers));

    onSignUpSuccess(newUser.profile);
  };

  return (
    <>
      {step === 1 ? (
        <form onSubmit={handleStep1Submit} className="space-y-4">
          <div>
            <Label htmlFor="signup-name" className="text-gray-100">
              Full Name *
            </Label>
            <Input
              id="signup-name"
              type="text"
              placeholder="John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div>
            <Label htmlFor="signup-email" className="text-gray-100">
              Email *
            </Label>
            <Input
              id="signup-email"
              type="email"
              placeholder="john.doe@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div>
            <Label htmlFor="signup-password" className="text-gray-100">
              Password *
            </Label>
            <Input
              id="signup-password"
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
              required
            />
            <div className="mt-2 flex items-center justify-between text-xs">
              <label className="inline-flex items-center gap-2 text-gray-300">
                <input
                  type="checkbox"
                  checked={showPassword}
                  onChange={(e) => setShowPassword(e.target.checked)}
                  className="accent-green-500"
                />
                Show password
              </label>
              <span className={strengthColorMap[passwordStrength]}>Strength: {passwordStrength}</span>
            </div>
          </div>

          <div>
            <Label htmlFor="signup-confirm-password" className="text-gray-100">
              Confirm Password *
            </Label>
            <Input
              id="signup-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              placeholder="Re-enter your password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={INPUT_CLASS}
              required
            />
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showConfirmPassword}
                onChange={(e) => setShowConfirmPassword(e.target.checked)}
                className="accent-green-500"
              />
              Show confirm password
            </label>
          </div>

          <Button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-md shadow-lg shadow-green-500/50 transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-xl hover:shadow-green-500/70"
          >
            Start Face Sample Collection
          </Button>
        </form>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-gray-300 text-center">
            Starting face sample collection. Follow the voice and written instructions to capture all required poses.
          </p>
          <FaceCapture onCaptureComplete={handleFaceCaptureComplete} onError={onSignUpError} />
        </div>
      )}
    </>
  );
};

export default SignUp;
