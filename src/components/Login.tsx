import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getFaceProfile, isFaceMatch } from '@/utils/faceUtils';
import { detectSingleFaceDescriptor, loadFaceApiModels } from '@/utils/faceApi';

interface LoginProps {
  onLoginSuccess: (profile: {
    name: string;
    email: string;
    photoUrl: string;
    faceVerified: boolean;
  }) => void;
  onLoginError: (message: string) => void;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INPUT_CLASS =
  'bg-black/70 border-green-500/50 text-green-100 placeholder:text-green-300/45 caret-green-300 focus-visible:ring-green-500 focus-visible:ring-offset-0';
const FACE_CHECK_SECONDS = 3;
const MAX_FACE_ATTEMPTS = 5;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const Login: React.FC<LoginProps> = ({ onLoginSuccess, onLoginError }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showFaceLogin, setShowFaceLogin] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [faceLoginAttempts, setFaceLoginAttempts] = useState(0);
  const [isFaceChecking, setIsFaceChecking] = useState(false);
  const [faceCountdown, setFaceCountdown] = useState(FACE_CHECK_SECONDS);
  const [faceInstruction, setFaceInstruction] = useState('Enter email, keep your face in frame, then start verification.');

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const retryTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  const clearRetryTimer = () => {
    if (retryTimerRef.current) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  };

  const speak = (message: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(message);
    utterance.rate = 0.96;
    window.speechSynthesis.speak(utterance);
  };

  const stopWebcam = () => {
    clearRetryTimer();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setIsFaceChecking(false);
    setFaceCountdown(FACE_CHECK_SECONDS);
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopWebcam();
    };
  }, []);

  useEffect(() => {
    if (showFaceLogin && !isLoadingModels) {
      void loadFaceModels();
    }

    if (!showFaceLogin) {
      stopWebcam();
      setFaceInstruction('Enter email, keep your face in frame, then start verification.');
    }
  }, [showFaceLogin]);

  const loadFaceModels = async () => {
    try {
      setIsLoadingModels(true);
      setFaceInstruction('Loading face verification models...');
      await loadFaceApiModels();
      await startFaceWebcam();
      setFaceInstruction('Center your face in camera and keep still for 3 seconds.');
      speak('Face login ready. Please center your face and hold still.');
    } catch (error) {
      console.error('Model loading failed:', error);
      onLoginError('Face recognition setup failed. Please use password login.');
      setShowFaceLogin(false);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const startFaceWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
    } catch (error) {
      onLoginError('Unable to access webcam. Please use password login.');
      setShowFaceLogin(false);
    }
  };

  const scheduleRetry = () => {
    clearRetryTimer();
    retryTimerRef.current = window.setTimeout(() => {
      void runFaceVerification();
    }, 900);
  };

  const runFaceVerification = async () => {
    if (!videoRef.current || !showFaceLogin || isFaceChecking) return;

    if (!email) {
      onLoginError('Please enter your email first.');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      onLoginError('Please enter a valid email address.');
      return;
    }

    setIsFaceChecking(true);
    setFaceInstruction('Hold still. Verifying your face...');
    speak('Hold still for three seconds while we verify your face.');

    let finalDetection: Awaited<ReturnType<typeof detectSingleFaceDescriptor>> | null = null;

    for (let sec = FACE_CHECK_SECONDS; sec >= 1; sec -= 1) {
      if (!mountedRef.current || !showFaceLogin) return;

      setFaceCountdown(sec);
      const detection = await detectSingleFaceDescriptor(videoRef.current);
      if (detection) {
        finalDetection = detection;
      }
      if (sec > 1) {
        await wait(1000);
      }
    }

    setIsFaceChecking(false);
    setFaceCountdown(FACE_CHECK_SECONDS);

    if (!finalDetection) {
      const nextAttempts = faceLoginAttempts + 1;
      setFaceLoginAttempts(nextAttempts);

      if (nextAttempts < MAX_FACE_ATTEMPTS) {
        setFaceInstruction('Face not detected clearly. Keep your face centered and retrying...');
        scheduleRetry();
        return;
      }

      onLoginError('No clear face detected. Please try password login.');
      stopWebcam();
      setShowFaceLogin(false);
      return;
    }

    const faceProfile = getFaceProfile(email);
    if (!faceProfile) {
      onLoginError('No face data found for this email. Please sign up again.');
      stopWebcam();
      setShowFaceLogin(false);
      return;
    }

    if (!isFaceMatch(finalDetection.descriptor, faceProfile.samples)) {
      const nextAttempts = faceLoginAttempts + 1;
      setFaceLoginAttempts(nextAttempts);

      if (nextAttempts < MAX_FACE_ATTEMPTS) {
        setFaceInstruction('Face mismatch. Adjust position and trying again...');
        scheduleRetry();
        return;
      }

      onLoginError('Face does not match. Please use password login.');
      stopWebcam();
      setShowFaceLogin(false);
      return;
    }

    const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const foundUser = storedUsers.find((user: any) => user.email === email);

    if (!foundUser) {
      onLoginError('User not found.');
      return;
    }

    setFaceInstruction('Face verified successfully. Logging you in...');
    speak('Face verified. Logging in now.');
    stopWebcam();
    setShowFaceLogin(false);
    onLoginSuccess(foundUser.profile);
  };

  const handlePasswordLogin = (e: React.FormEvent) => {
    e.preventDefault();

    if (!email || !password) {
      onLoginError('Please fill in all fields.');
      return;
    }

    if (!EMAIL_REGEX.test(email)) {
      onLoginError('Please enter a valid email address.');
      return;
    }

    if (password.length < 8) {
      onLoginError('Password must be at least 8 characters long.');
      return;
    }

    const storedUsers = JSON.parse(localStorage.getItem('users') || '[]');
    const foundUser = storedUsers.find((user: any) => user.email === email && user.password === password);

    if (foundUser) {
      onLoginSuccess(foundUser.profile);
    } else {
      onLoginError('Invalid email or password.');
    }
  };

  const closeFaceLogin = () => {
    stopWebcam();
    setShowFaceLogin(false);
    setFaceLoginAttempts(0);
  };

  return (
    <>
      {showFaceLogin ? (
        <div className="space-y-4">
          <div>
            <Label htmlFor="face-email" className="text-gray-100">
              Email
            </Label>
            <Input
              id="face-email"
              type="email"
              placeholder="test@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div className="relative rounded-lg overflow-hidden bg-black border border-green-500/50">
            <video ref={videoRef} autoPlay muted playsInline className="w-full h-80 object-cover -scale-x-100" />
          </div>

          <div className="rounded border border-green-500/30 bg-black/50 p-3 text-sm text-green-100 text-center">
            {faceInstruction}
            {isFaceChecking ? <div className="mt-1 text-green-300">Checking in {faceCountdown}s...</div> : null}
          </div>

          <p className="text-sm text-gray-300 text-center">Face verification attempts: {faceLoginAttempts}/{MAX_FACE_ATTEMPTS}</p>

          <div className="flex gap-2">
            <Button onClick={closeFaceLogin} className="flex-1 bg-red-600 hover:bg-red-700 text-white">
              Cancel
            </Button>
            <Button
              onClick={() => void runFaceVerification()}
              disabled={isFaceChecking || isLoadingModels}
              className="flex-1 bg-green-600 hover:bg-green-700 text-white"
            >
              {isFaceChecking ? 'Checking...' : 'Start 3s Face Check'}
            </Button>
          </div>

          <Button onClick={closeFaceLogin} variant="outline" className="w-full text-gray-300 border-gray-600 hover:bg-black/60">
            Use Password Instead
          </Button>
        </div>
      ) : (
        <form onSubmit={handlePasswordLogin} className="space-y-4">
          <div>
            <Label htmlFor="email" className="text-gray-100">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="test@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value.trim())}
              className={INPUT_CLASS}
              required
            />
          </div>

          <div>
            <Label htmlFor="password" className="text-gray-100">
              Password
            </Label>
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={INPUT_CLASS}
              required
            />
            <label className="mt-2 inline-flex items-center gap-2 text-xs text-gray-300">
              <input
                type="checkbox"
                checked={showPassword}
                onChange={(e) => setShowPassword(e.target.checked)}
                className="accent-green-500"
              />
              Show password
            </label>
          </div>

          <Button
            type="submit"
            className="w-full bg-green-600 hover:bg-green-700 text-white font-bold rounded-md shadow-lg shadow-green-500/50 transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-xl hover:shadow-green-500/70"
          >
            Login with Password
          </Button>

          <Button
            type="button"
            onClick={() => setShowFaceLogin(true)}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-md shadow-lg shadow-blue-500/50 transition-all duration-300 ease-in-out hover:scale-105 hover:shadow-xl hover:shadow-blue-500/70"
          >
            Login with Face Recognition
          </Button>
        </form>
      )}
    </>
  );
};

export default Login;
