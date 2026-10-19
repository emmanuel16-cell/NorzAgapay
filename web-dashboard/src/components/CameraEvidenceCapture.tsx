import { useEffect, useRef, useState } from 'react';
import { Camera, CircleStop, ImagePlus, Video, X } from 'lucide-react';

const MAX_VIDEO_SECONDS = 60;

type CameraEvidenceCaptureProps = {
  files: File[];
  onFilesChange: (files: File[]) => void;
  required?: boolean;
};

function fileExtension(mimeType: string) {
  if (mimeType.includes('mp4')) return 'mp4';
  if (mimeType.includes('quicktime')) return 'mov';
  if (mimeType.includes('webm')) return 'webm';
  return 'jpg';
}

function createCaptureName(mimeType: string, kind: 'photo' | 'video') {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${kind}-${timestamp}.${fileExtension(mimeType)}`;
}

export default function CameraEvidenceCapture({ files, onFilesChange, required = false }: CameraEvidenceCaptureProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraMessage, setCameraMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const onFilesChangeRef = useRef(onFilesChange);
  const filesRef = useRef(files);
  const cameraSessionRef = useRef(0);

  useEffect(() => {
    onFilesChangeRef.current = onFilesChange;
    filesRef.current = files;
  }, [files, onFilesChange]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      setRecordingSeconds((seconds) => Math.min(MAX_VIDEO_SECONDS, seconds + 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [recording]);

  useEffect(() => {
    if (recording && recordingSeconds >= MAX_VIDEO_SECONDS && recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, [recording, recordingSeconds]);

  useEffect(() => () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    stream?.getTracks().forEach((track) => track.stop());
  }, [stream]);

  const closeCamera = () => {
    cameraSessionRef.current += 1;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
    stream?.getTracks().forEach((track) => track.stop());
    setStream(null);
    setCameraOpen(false);
    setRecording(false);
    setRecordingSeconds(0);
  };

  const openCamera = async () => {
    const session = ++cameraSessionRef.current;
    setCameraOpen(true);
    setCameraMessage('Starting camera…');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('Camera capture needs a supported browser on a secure connection.');
      return;
    }
    try {
      const cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: true,
      });
      if (cameraSessionRef.current !== session) { cameraStream.getTracks().forEach((track) => track.stop()); return; }
      setStream(cameraStream);
      setCameraMessage('');
    } catch {
      try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cameraSessionRef.current !== session) { cameraStream.getTracks().forEach((track) => track.stop()); return; }
        setStream(cameraStream);
        setCameraMessage('Camera is ready. Video recording will not include audio because microphone access is unavailable.');
      } catch {
        if (cameraSessionRef.current !== session) return;
        setCameraMessage('Camera access was not available. Allow camera access in your browser settings and try again.');
      }
    }
  };

  const appendEvidence = (file: File) => {
    const nextFiles = [...filesRef.current, file];
    filesRef.current = nextFiles;
    onFilesChangeRef.current(nextFiles);
  };

  const capturePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraMessage('Wait for the camera preview, then take the photo.');
      return;
    }
    const maxDimension = 1920;
    const scale = Math.min(1, maxDimension / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const context = canvas.getContext('2d');
    if (!context) {
      setCameraMessage('Could not capture the photo. Try again.');
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraMessage('Could not capture the photo. Try again.');
        return;
      }
      const photo = new File([blob], createCaptureName(blob.type || 'image/jpeg', 'photo'), { type: blob.type || 'image/jpeg' });
      appendEvidence(photo);
      setCameraMessage('Photo added to the report.');
    }, 'image/jpeg', 0.86);
  };

  const startRecording = () => {
    if (!stream) return;
    if (typeof MediaRecorder === 'undefined') {
      setCameraMessage('Video recording is not supported in this browser. You can still take a photo.');
      return;
    }
    const supportedType = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']
      .find((mimeType) => MediaRecorder.isTypeSupported?.(mimeType));
    try {
      const recorder = supportedType ? new MediaRecorder(stream, { mimeType: supportedType }) : new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || chunksRef.current[0]?.type || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size > 0) {
          const video = new File([blob], createCaptureName(type, 'video'), { type });
          appendEvidence(video);
          setCameraMessage('Video added to the report.');
        }
        chunksRef.current = [];
        recorderRef.current = null;
        setRecording(false);
      };
      recorderRef.current = recorder;
      setRecordingSeconds(0);
      setCameraMessage('');
      recorder.start();
      setRecording(true);
    } catch {
      setCameraMessage('Could not start video recording. Try taking a photo instead.');
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const removeFile = (index: number) => {
    const nextFiles = files.filter((_, fileIndex) => fileIndex !== index);
    filesRef.current = nextFiles;
    onFilesChangeRef.current(nextFiles);
  };

  return <div className="camera-evidence-control">
    <div className="camera-evidence-heading">
      <strong>Photo or video evidence {required ? <b>Required</b> : <span>Optional</span>}</strong>
      <small>Capture it with your camera. Files and gallery uploads are not available.</small>
    </div>
    <button className="camera-evidence-open" type="button" onClick={() => void openCamera()}>
      <Camera size={17} aria-hidden="true" /> Open camera
    </button>
    {files.length > 0 && <ul className="camera-evidence-files" aria-label="Captured report evidence">
      {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>
        <span><ImagePlus size={14} aria-hidden="true" />{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
        <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>Remove</button>
      </li>)}
    </ul>}

    {cameraOpen && <div className="camera-capture-backdrop" role="presentation">
      <section className="camera-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-capture-title">
        <header>
          <div><h2 id="camera-capture-title">Capture report evidence</h2><p>Take a photo or record a video. Nothing is selected from your device.</p></div>
          <button type="button" className="camera-capture-close" aria-label="Close camera" onClick={closeCamera}><X size={18} /></button>
        </header>
        {stream
          ? <video ref={videoRef} className="camera-capture-preview" autoPlay playsInline muted />
          : <div className="camera-capture-placeholder"><Camera size={28} /><span>{cameraMessage || 'Waiting for camera…'}</span></div>}
        {cameraMessage && stream && <p className="camera-capture-message" role="status">{cameraMessage}</p>}
        {recording && <p className="camera-capture-recording" role="status"><span /> Recording · {recordingSeconds}s / {MAX_VIDEO_SECONDS}s</p>}
        <footer>
          <button type="button" className="camera-capture-action" onClick={capturePhoto} disabled={!stream || recording}><Camera size={16} /> Take photo</button>
          {recording
            ? <button type="button" className="camera-capture-action camera-capture-stop" onClick={stopRecording}><CircleStop size={16} /> Stop video</button>
            : <button type="button" className="camera-capture-action" onClick={startRecording} disabled={!stream}><Video size={16} /> Record video</button>}
          <button type="button" className="camera-capture-done" onClick={closeCamera}>{recording ? 'Stop and use video' : 'Done'}</button>
        </footer>
      </section>
    </div>}
  </div>;
}
