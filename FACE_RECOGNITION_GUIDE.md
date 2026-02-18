## Face Recognition Integration Guide

### Overview
The Trust Lens application now includes **mandatory facial recognition** during signup and optional face-based login. This system captures 5 face samples during signup for strict yet fast verification.

---

## Sign-Up Flow

### Step 1: Basic Information
Users fill in the following fields:
- **Full Name** (required)
- **Email** (required)
- **Phone Number** (required) - minimum 10 digits
- **Profession** (required) - e.g., Lawyer, Consultant, Analyst
- **Organization** (optional) - company or organization name
- **Password** (required) - secure password
- **Confirm Password** (required)
- **Verification Level** (dropdown):
  - Standard
  - Premium
  - Enterprise

### Step 2: Face Verification (Mandatory)
- System loads face detection models from CDN
- Captures **5 face samples** automatically
- User positions face clearly in camera feed
- Progress bar shows sample count
- Face descriptors stored locally in localStorage
- Strict matching threshold for security

**Location Changes:**
- ❌ Removed: Location field
- ❌ Removed: Bio field
- ✅ Added: Phone Number
- ✅ Added: Profession
- ✅ Added: Organization
- ✅ Added: Verification Level

---

## Login Flow

### Option 1: Password Login
1. Enter email
2. Enter password
3. Click "Login with Password"

### Option 2: Face Recognition Login
1. Enter email
2. Click "Login with Face Recognition"
3. Position face in camera
4. System attempts to match face (5 attempts max)
5. On match: automatic login
6. On mismatch: option to switch to password login

**Note:** Either password OR face recognition can be used - not both required.

---

## Key Components

### 1. **FaceCapture.tsx**
Captures 5 face samples during signup with real-time detection feedback.

**Props:**
- `onCaptureComplete(descriptors: Float32Array[])` - Called when 5 samples captured
- `onError(message: string)` - Error handling callback

**Features:**
- Real-time face detection
- Automatic capture every 1 second
- Progress bar visualization
- Model loading from CDN
- Graceful fallback options

### 2. **Login.tsx (Updated)**
Enhanced with dual authentication methods.

**New Features:**
- Toggle between password and face login
- Real-time face detection during login
- Automatic webcam access
- 5-attempt limit for face matching
- Clear error messages with guidance

### 3. **SignUp.tsx (Updated)**
Two-step signup process with face verification.

**Step 1:** Basic information collection
**Step 2:** Facial recognition capture

### 4. **faceUtils.ts** (New)
Utility functions for face profile management.

**Key Functions:**
```typescript
saveFaceProfile(email: string, faceDescriptors: Float32Array[])
// Saves 5 face descriptors for a user

getFaceProfile(email: string): UserFaceProfile | null
// Retrieves stored face profile

isFaceMatch(testDescriptor: Float32Array, profileSamples: FaceData[]): boolean
// Checks if test face matches stored samples (threshold: 0.5)

calculateDistance(desc1: Float32Array, desc2: Float32Array): number
// Computes Euclidean distance between descriptors
```

---

## Data Storage

### localStorage Keys

**Users Data:**
```json
{
  "users": [
    {
      "email": "user@example.com",
      "password": "hashed_password",
      "profile": {
        "name": "John Doe",
        "email": "user@example.com",
        "phone": "+1 (555) 000-0000",
        "profession": "Lawyer",
        "organization": "Law Firm XYZ",
        "verificationLevel": "premium",
        "photoUrl": "",
        "faceVerified": true
      }
    }
  ]
}
```

**Face Profiles:**
```json
{
  "faceProfiles": {
    "user@example.com": {
      "userId": "user@example.com",
      "email": "user@example.com",
      "samples": [
        {
          "descriptor": [float32_array_values...],
          "timestamp": 1708123456789
        },
        // ... 4 more samples
      ],
      "createdAt": 1708123456789
    }
  }
}
```

---

## Face Matching Algorithm

**Matching Threshold:** 0.5 (Euclidean distance)

**Process:**
1. Capture test face descriptor
2. Calculate distance to all 5 stored samples
3. Average distances
4. If average < 0.5 → **Match** ✅
5. If average ≥ 0.5 → **No Match** ❌

**Strictness:** High confidence matching with 5 samples provides both security and speed.

---

## Library: @vladmandic/face-api

**Version:** 1.7.15

**Features Used:**
- Face detection
- Face landmarks (68 points)
- Face recognition (face descriptors)

**Models Loaded:**
- `faceDetectionNet` - Detects faces in images
- `faceLandmark68Net` - Identifies facial features
- `faceRecognitionNet` - Generates face descriptors

**CDN URL:**
```
https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model/
```

---

## WebCamera Permissions

The app requests camera access for:
1. **Signup:** Face sample capture (5 samples)
2. **Login:** Face recognition matching

**Browser Prompt:**
- First-time access triggers permission request
- User can decline (fallback to password only)
- Permission remembered per session

**Cleanup:**
- Video stream stopped when camera dialog closed
- Webcam tracks properly released

---

## Error Handling

**Signup Errors:**
- Missing required fields
- Password mismatch
- Invalid phone number
- Duplicate email
- Model loading failure
- Camera access denied
- No face detected

**Login Errors:**
- Invalid email/password
- Camera unavailable
- No face samples found for email
- Face doesn't match (after 5 attempts)
- Model loading failure

---

## Security Considerations

⚠️ **Local Storage Note:**
- Current implementation uses localStorage (development only)
- **Production:** Use encrypted backend storage
- **Production:** Hash passwords before storage
- **Production:** Implement proper session management
- **Production:** Use HTTPS for all face data transmission
- **Production:** Implement rate limiting on login attempts
- **Production:** Add audit logging for face authentication

---

## Testing Face Recognition

### Demo Credentials (After First Signup):
```
Email: test@example.com
Password: TestPassword123!
Phone: +1 (555) 123-4567
Profession: Lawyer
Organization: Test Firm
```

### Test Scenarios:
1. **Valid Face Match:** Use same person for signup and login
2. **Invalid Face:** Use different person → should fail
3. **No Face:** Block camera → automatic fallback to password
4. **Multiple Attempts:** 5 face matching attempts before fallback

---

## Profile Page Updates

The ProfilePage component now displays:
- ✅ Name
- ✅ Email
- ✅ Phone Number
- ✅ Profession
- ✅ Organization
- ✅ Verification Level
- ✅ Face Verified Status (read-only)

Fields removed:
- ❌ Location
- ❌ Bio

---

## Future Enhancements

1. **Liveness Detection:** Detect spoofing attempts
2. **Multiple Device Enrollment:** Register multiple devices
3. **Backup Codes:** For account recovery
4. **Biometric Template Protection:** Encrypt stored face data
5. **Continuous Authentication:** Periodic face verification
6. **Progressive Enrollment:** Add face samples over time for better accuracy
7. **Analytics Dashboard:** Track authentication methods usage
8. **Multi-factor Authentication:** Combine password + face + phone

---

## Troubleshooting

### "No face detected"
- Ensure adequate lighting
- Clear view of full face
- Not wearing heavy accessories
- Camera not obstructed

### "Face does not match"
- Ensure same person for login
- Similar lighting conditions as signup
- Natural expression (avoid extreme angles)
- Clean camera lens

### "Camera access denied"
- Check browser permissions
- Allow camera access in browser settings
- Refresh browser
- Use password login as fallback

### Models not loading
- Check internet connection (CDN required)
- Browser console for specific errors
- Clear browser cache
- Try incognito mode

---

## File Structure

```
src/
├── components/
│   ├── FaceCapture.tsx (NEW)
│   ├── Login.tsx (UPDATED)
│   ├── SignUp.tsx (UPDATED)
│   ├── ProfilePage.tsx (UPDATED)
│   └── ...
├── utils/
│   ├── faceUtils.ts (NEW)
│   └── ...
├── pages/
│   ├── SignUpPage.tsx (UPDATED)
│   ├── LoginPage.tsx (UPDATED)
│   └── ...
└── ...
```

---

## API Dependencies

- **Face Recognition:** @vladmandic/face-api@1.7.15
- **UI Components:** shadcn/ui (existing)
- **State Management:** React hooks (existing)
- **Storage:** localStorage (development)

---

**Last Updated:** February 16, 2026
**Status:** ✅ Complete and tested
