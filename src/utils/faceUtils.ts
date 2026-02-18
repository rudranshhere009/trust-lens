// Face verification utilities
export interface FaceData {
  descriptor: Float32Array;
  timestamp: number;
}

export interface UserFaceProfile {
  userId: string;
  email: string;
  samples: FaceData[];
  createdAt: number;
}

// Store face profile in localStorage
export const saveFaceProfile = (email: string, faceDescriptors: Float32Array[]) => {
  const profile: UserFaceProfile = {
    userId: email,
    email,
    samples: faceDescriptors.map((descriptor) => ({
      descriptor,
      timestamp: Date.now(),
    })),
    createdAt: Date.now(),
  };
  
  const faceProfiles = JSON.parse(localStorage.getItem('faceProfiles') || '{}');
  faceProfiles[email] = {
    userId: profile.userId,
    email: profile.email,
    samples: profile.samples.map(s => ({
      descriptor: Array.from(s.descriptor),
      timestamp: s.timestamp,
    })),
    createdAt: profile.createdAt,
  };
  localStorage.setItem('faceProfiles', JSON.stringify(faceProfiles));
};

// Get face profile from localStorage
export const getFaceProfile = (email: string): UserFaceProfile | null => {
  const faceProfiles = JSON.parse(localStorage.getItem('faceProfiles') || '{}');
  const profile = faceProfiles[email];
  
  if (!profile) return null;
  
  return {
    userId: profile.userId,
    email: profile.email,
    samples: profile.samples.map((s: any) => ({
      descriptor: new Float32Array(s.descriptor),
      timestamp: s.timestamp,
    })),
    createdAt: profile.createdAt,
  };
};

// Calculate distance between two face descriptors
export const calculateDistance = (desc1: Float32Array, desc2: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < desc1.length; i++) {
    const diff = desc1[i] - desc2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
};

// Check if face matches (average distance threshold)
export const isFaceMatch = (testDescriptor: Float32Array, profileSamples: FaceData[]): boolean => {
  const MATCH_THRESHOLD = 0.5; // Adjust based on strictness
  const distances = profileSamples.map(sample => calculateDistance(testDescriptor, sample.descriptor));
  const avgDistance = distances.reduce((a, b) => a + b, 0) / distances.length;
  return avgDistance < MATCH_THRESHOLD;
};
