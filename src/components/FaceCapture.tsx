import React, { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { loadFaceApiModels, detectSingleFaceDescriptor } from '@/utils/faceApi';

interface FaceCaptureProps {
  onCaptureComplete: (descriptors: Float32Array[]) => void;
  onError: (message: string) => void;
}

type PoseKey = 'front' | 'up' | 'down' | 'left' | 'right';

type CaptureStep = {
  key: PoseKey;
  title: string;
  instruction: string;
  voicePrompt: string;
};

const CAPTURE_SEQUENCE: CaptureStep[] = [
  {
    key: 'front',
    title: 'Front Face',
    instruction: 'Look straight into the camera.',
    voicePrompt: 'Look straight into the camera.',
  },
  {
    key: 'up',
    title: 'Look Up',
    instruction: 'Lift your chin slightly and look upward.',
    voicePrompt: 'Look up. Lift your chin slightly.',
  },
  {
    key: 'down',
    title: 'Look Down',
    instruction: 'Lower your chin and look downward.',
    voicePrompt: 'Look down. Lower your chin slightly.',
  },
];

const HOLD_SECONDS = 5;
const RETRY_ATTEMPTS = 6;
const RETRY_DELAY_MS = 500;
const BETWEEN_STEPS_DELAY_MS = 700;
const CORRECTION_COOLDOWN_MS = 2600;
const GUIDE_FRAME_SIZE_RATIO = 0.62;
const MIN_IN_GUIDE_SECONDS = 4;

const MIN_POSE_MATCH_SECONDS: Record<PoseKey, number> = {
  front: 3,
  up: 2,
  down: 2,
  left: 2,
  right: 2,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Point = { x: number; y: number };

type FaceDetection = Awaited<ReturnType<typeof detectSingleFaceDescriptor>>;

const averagePoint = (points: Point[]): Point => {
  const total = points.reduce(
    (acc, point) => ({ x: acc.x + point.x, y: acc.y + point.y }),
    { x: 0, y: 0 }
  );
  return { x: total.x / points.length, y: total.y / points.length };
};

const getGuideFrameBounds = (videoWidth: number, videoHeight: number) => {
  const frameSize = Math.min(videoWidth, videoHeight) * GUIDE_FRAME_SIZE_RATIO;
  const left = (videoWidth - frameSize) / 2;
  const top = (videoHeight - frameSize) / 2;
  return {
    left,
    top,
    right: left + frameSize,
    bottom: top + frameSize,
  };
};

const FaceCapture: React.FC<FaceCaptureProps> = ({ onCaptureComplete, onError }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState<'permission' | 'loading' | 'ready' | 'capturing'>('permission');
  const [samplesCollected, setSamplesCollected] = useState(0);
  const [isVideoReady, setIsVideoReady] = useState(false);
  const [hasStartedSession, setHasStartedSession] = useState(false);
  const [currentPoseIndex, setCurrentPoseIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(HOLD_SECONDS);
  const [poseFeedback, setPoseFeedback] = useState('Align your face with the guide and hold still.');

  const descriptorsRef = useRef<Float32Array[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const captureInProgressRef = useRef(false);
  const lastCorrectionAtRef = useRef(0);

  const speakInstruction = (message: string, interrupt = true): Promise<void> => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return Promise.resolve();

    if (interrupt) {
      window.speechSynthesis.cancel();
    }

    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.rate = 0.95;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
  };

  const stopCaptureSession = () => {
    captureInProgressRef.current = false;
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  };

  const bindStreamToVideo = async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream) return;

    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }

    try {
      await video.play();
    } catch (error) {
      console.error('Failed to play camera stream:', error);
    }
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setIsVideoReady(false);
  };

  const requestCameraPermission = async () => {
    try {
      setStep('loading');
      setIsVideoReady(false);

      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 } },
      });
      streamRef.current = stream;

      await loadFaceApiModels();
      setStep('ready');
    } catch (error) {
      onError('Camera permission denied. Please allow camera access to continue.');
      setStep('permission');
      stopWebcam();
    }
  };

  const evaluatePose = (
    detection: FaceDetection | null,
    expectedPose: PoseKey
  ): { matches: boolean; inGuide: boolean; correction: string } => {
    if (!detection) {
      return { matches: false, inGuide: false, correction: 'Move your face inside the blue frame and hold still.' };
    }

    const video = videoRef.current;
    if (!video) {
      return { matches: false, inGuide: false, correction: 'Initializing camera. Please hold still.' };
    }

    const bounds = getGuideFrameBounds(video.videoWidth || 640, video.videoHeight || 480);
    const box = detection.detection.box;
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const insideGuide =
      centerX >= bounds.left &&
      centerX <= bounds.right &&
      centerY >= bounds.top &&
      centerY <= bounds.bottom;

    if (!insideGuide) {
      return { matches: false, inGuide: false, correction: 'Keep your face inside the blue square.' };
    }

    const leftEye = averagePoint(detection.landmarks.getLeftEye());
    const rightEye = averagePoint(detection.landmarks.getRightEye());
    const nose = averagePoint(detection.landmarks.getNose().slice(3, 6));
    const mouth = averagePoint(detection.landmarks.getMouth());

    const eyeCenterX = (leftEye.x + rightEye.x) / 2;
    const eyeCenterY = (leftEye.y + rightEye.y) / 2;
    const eyeDistance = Math.max(Math.abs(rightEye.x - leftEye.x), 1);
    const faceHeight = Math.max(Math.abs(mouth.y - eyeCenterY), 1);

    const yaw = (nose.x - eyeCenterX) / eyeDistance;
    const pitch = (nose.y - eyeCenterY) / faceHeight;

    if (expectedPose === 'front') {
      if (Math.abs(yaw) <= 0.2 && pitch >= 0.15 && pitch <= 0.82) {
        return { matches: true, inGuide: true, correction: 'Great. Hold this position.' };
      }
      return { matches: false, inGuide: true, correction: 'Face mostly straight to the camera.' };
    }

    if (expectedPose === 'up') {
      if (pitch < 0.45) {
        return { matches: true, inGuide: true, correction: 'Good upward pose. Keep still.' };
      }
      return { matches: false, inGuide: true, correction: 'Lift your chin a bit and look up.' };
    }

    if (expectedPose === 'down') {
      if (pitch > 0.42) {
        return { matches: true, inGuide: true, correction: 'Good downward pose. Keep still.' };
      }
      return { matches: false, inGuide: true, correction: 'Lower your chin a bit and look down.' };
    }

    if (expectedPose === 'left') {
      if (yaw < -0.035) {
        return { matches: true, inGuide: true, correction: 'Left pose is correct. Hold still.' };
      }
      return { matches: false, inGuide: true, correction: 'Turn your face slightly more to the left.' };
    }

    if (yaw > 0.035) {
      return { matches: true, inGuide: true, correction: 'Right pose is correct. Hold still.' };
    }
    return { matches: false, inGuide: true, correction: 'Turn your face slightly more to the right.' };
  };

  const maybeSpeakCorrection = (message: string) => {
    const now = Date.now();
    if (now - lastCorrectionAtRef.current < CORRECTION_COOLDOWN_MS) return;
    lastCorrectionAtRef.current = now;
    void speakInstruction(message, false);
  };

  const captureDetectionWithRetries = async (): Promise<FaceDetection | null> => {
    const video = videoRef.current;
    if (!video || !isVideoReady) return null;

    for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
      if (!captureInProgressRef.current) return null;

      const detection = await detectSingleFaceDescriptor(video);
      if (detection) {
        return detection;
      }

      await wait(RETRY_DELAY_MS);
    }

    return null;
  };

  const runCountdownWithPoseCheck = async (durationSeconds: number, pose: PoseKey): Promise<boolean> => {
    setSecondsLeft(durationSeconds);
    let remaining = durationSeconds;
    let poseMatchSeconds = 0;
    let inGuideSeconds = 0;

    while (captureInProgressRef.current && remaining > 0) {
      const detection = await captureDetectionWithRetries();
      const result = evaluatePose(detection, pose);
      setPoseFeedback(result.correction);
      if (result.matches) poseMatchSeconds += 1;
      if (result.inGuide) inGuideSeconds += 1;

      if (!result.matches) {
        maybeSpeakCorrection(result.correction);
      }

      remaining -= 1;
      setSecondsLeft(Math.max(remaining, 0));
      await wait(1000);
    }

    if (!captureInProgressRef.current) return false;
    return inGuideSeconds >= MIN_IN_GUIDE_SECONDS && poseMatchSeconds >= MIN_POSE_MATCH_SECONDS[pose];
  };

  const runGuidedCapture = async () => {
    descriptorsRef.current = [];
    setSamplesCollected(0);

    for (let i = 0; i < CAPTURE_SEQUENCE.length; i += 1) {
      if (!captureInProgressRef.current) return;

      const stepInfo = CAPTURE_SEQUENCE[i];
      setCurrentPoseIndex(i);
      setPoseFeedback(stepInfo.instruction);

      await speakInstruction(
        `Step ${i + 1} of ${CAPTURE_SEQUENCE.length}. ${stepInfo.voicePrompt} Hold still for ${HOLD_SECONDS} seconds.`
      );

      const completedHold = await runCountdownWithPoseCheck(HOLD_SECONDS, stepInfo.key);
      if (!completedHold) {
        setPoseFeedback('Almost there. Keeping last best sample for smoother flow.');
      }

      const detection = await captureDetectionWithRetries();
      if (!detection) {
        stopCaptureSession();
        setStep('ready');
        onError(`Could not capture a clear face for step ${i + 1}. Please keep your face visible and restart capture.`);
        return;
      }

      descriptorsRef.current.push(detection.descriptor);
      setSamplesCollected(i + 1);
      await speakInstruction(`Step ${i + 1} captured.`);

      if (i < CAPTURE_SEQUENCE.length - 1) {
        await wait(BETWEEN_STEPS_DELAY_MS);
      }
    }

    stopCaptureSession();
    setStep('ready');
    stopWebcam();
    void speakInstruction('Face sample collection complete. Redirecting to login.');
    onCaptureComplete([...descriptorsRef.current]);
  };

  const startCapturing = () => {
    if (hasStartedSession) {
      onError('Face sample collection already started for this page session.');
      return;
    }

    if (!isVideoReady) {
      onError('Camera is still initializing. Please wait a moment and try again.');
      return;
    }

    setHasStartedSession(true);
    captureInProgressRef.current = true;
    setStep('capturing');
    setCurrentPoseIndex(0);
    setSecondsLeft(HOLD_SECONDS);
    setPoseFeedback(CAPTURE_SEQUENCE[0].instruction);
    void runGuidedCapture();
  };

  useEffect(() => {
    void bindStreamToVideo();
  }, [step]);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    const handleBeforeUnload = () => {
      stopCaptureSession();
      stopWebcam();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      stopCaptureSession();
      stopWebcam();
    };
  }, []);

  return (
    <div className="space-y-4">
      <Label className="text-green-300">Face Verification (Required)</Label>

      {step === 'permission' && (
        <div className="space-y-4">
          <p className="text-sm text-gray-400 text-center">
            We need access to your camera to verify your face for security purposes.
          </p>
          <Button onClick={requestCameraPermission} className="w-full bg-green-600 hover:bg-green-700 text-white">
            Allow Camera & Continue
          </Button>
        </div>
      )}

      {step === 'loading' && (
        <div className="space-y-4">
          <div className="relative rounded-lg overflow-hidden bg-black border border-green-500/50 h-80 flex items-center justify-center">
            <p className="text-green-400">Loading face detection models...</p>
          </div>
        </div>
      )}

      {(step === 'ready' || step === 'capturing') && (
        <>
          <p className="text-sm text-gray-300 mb-2">
            Follow voice and on-screen guidance. Each pose is captured after a {HOLD_SECONDS}-second hold.
          </p>

          <div className="space-y-2 rounded border border-green-500/30 bg-black/40 p-3">
            {CAPTURE_SEQUENCE.map((pose, index) => {
              const isDone = index < samplesCollected;
              const isActive = step === 'capturing' && index === currentPoseIndex;

              return (
                <div
                  key={pose.title}
                  className={`text-sm ${isDone ? 'text-green-300' : isActive ? 'text-green-100' : 'text-gray-400'}`}
                >
                  {isDone ? 'Done' : isActive ? 'Now' : 'Next'} {index + 1}. {pose.title}: {pose.instruction}
                </div>
              );
            })}
          </div>

          {step === 'capturing' && (
            <div className="rounded border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-200">
              Hold pose: {CAPTURE_SEQUENCE[currentPoseIndex].title}. Capturing in {secondsLeft}s.
            </div>
          )}

          <div className="rounded border border-green-500/30 bg-black/60 p-3 text-sm text-green-100">{poseFeedback}</div>

          <div className="relative rounded-lg overflow-hidden bg-black border border-green-500/50">
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              onLoadedMetadata={() => setIsVideoReady(true)}
              className="w-full h-80 object-cover -scale-x-100"
            />
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="rounded-md border-2 border-blue-400/90 bg-blue-400/10 shadow-[0_0_0_1px_rgba(59,130,246,0.6),0_0_20px_rgba(59,130,246,0.25)]"
                style={{ width: '62%', maxWidth: '280px', aspectRatio: '1 / 1' }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between bg-black/50 p-3 rounded border border-green-500/30">
            <span className="text-green-300 font-semibold">
              Samples captured: {samplesCollected}/{CAPTURE_SEQUENCE.length}
            </span>
            <div className="w-24 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all duration-300"
                style={{ width: `${(samplesCollected / CAPTURE_SEQUENCE.length) * 100}%` }}
              />
            </div>
          </div>

          {step === 'capturing' ? (
            <Button disabled className="w-full bg-gray-700 text-gray-200 cursor-not-allowed">
              Capturing Sequence in Progress...
            </Button>
          ) : (
            <Button
              onClick={startCapturing}
              disabled={!isVideoReady || hasStartedSession}
              className="w-full bg-green-600 hover:bg-green-700 text-white"
            >
              {!isVideoReady ? 'Starting Camera...' : hasStartedSession ? 'Capture Session Started' : 'Start Face Sample Collection'}
            </Button>
          )}
        </>
      )}
    </div>
  );
};

export default FaceCapture;
