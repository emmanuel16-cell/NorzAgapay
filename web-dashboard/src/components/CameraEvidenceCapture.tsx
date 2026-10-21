import { useEffect, useRef, useState } from 'react';
import { Camera, CircleStop, ImagePlus, Video, X } from 'lucide-react';

const MAX_VIDEO_SECONDS = 60;
const MAX_CAPTURE_FILES = 5;
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  '3gp': 'video/3gpp', mkv: 'video/x-matroska',
};
const SUPPORTED_MIME_TYPES = new Set(Object.values(MIME_BY_EXTENSION));

type CameraEvidenceCaptureProps = {
  files: File[];
  onFilesChange: (files: File[]) => void;
  required?: boolean;
  allowFileSelection?: boolean;
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

export default function CameraEvidenceCapture({ files, onFilesChange, required = false, allowFileSelection = true }: CameraEvidenceCaptureProps) {
  const [cameraOpen, setCameraOpen] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraMessage, setCameraMessage] = useState('');
  const [recording, setRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const declaredMime = file.type.toLowerCase().split(';')[0].trim();
    const mimeType = !declaredMime || declaredMime === 'application/octet-stream'
      ? MIME_BY_EXTENSION[extension] || declaredMime
      : declaredMime;
    if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
      setCameraMessage('Choose a photo or video file.');
      return false;
    }
    if (file.size > MAX_MEDIA_BYTES) {
      setCameraMessage('Each photo or video must be 50 MB or smaller.');
      return false;
    }
    if (filesRef.current.length >= MAX_CAPTURE_FILES) {
      setCameraMessage(`You can attach up to ${MAX_CAPTURE_FILES} photos or videos.`);
      return false;
    }
    const normalizedFile = file.type === mimeType
      ? file
      : new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
    const nextFiles = [...filesRef.current, normalizedFile];
    filesRef.current = nextFiles;
    onFilesChangeRef.current(nextFiles);
    return true;
  };

  const addSelectedFiles = (selectedFiles: FileList | null) => {
    if (!selectedFiles?.length) return;
    let addedCount = 0;
    for (const file of Array.from(selectedFiles)) {
      if (appendEvidence(file)) addedCount += 1;
    }
    if (addedCount > 0) {
      const rejectedCount = selectedFiles.length - addedCount;
      setCameraMessage(rejectedCount > 0
        ? `${addedCount} photo or video${addedCount === 1 ? '' : 's'} added. ${rejectedCount} file${rejectedCount === 1 ? ' was' : 's were'} skipped; check file type, size, and the five-file limit.`
        : `${addedCount} photo or video${addedCount === 1 ? '' : 's'} added to the report.`);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
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
      if (appendEvidence(photo)) setCameraMessage('Photo added to the report.');
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
      const options: MediaRecorderOptions = {
        ...(supportedType ? { mimeType: supportedType } : {}),
        videoBitsPerSecond: 700_000,
        audioBitsPerSecond: 64_000,
      };
      const recorder = new MediaRecorder(stream, options);
      chunksRef.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const type = recorder.mimeType || chunksRef.current[0]?.type || 'video/webm';
        const blob = new Blob(chunksRef.current, { type });
        if (blob.size > 0) {
          if (blob.size > MAX_VIDEO_BYTES) {
            setCameraMessage('This video is larger than 50 MB. Record a shorter clip and try again.');
          } else {
            const video = new File([blob], createCaptureName(type, 'video'), { type });
            if (appendEvidence(video)) setCameraMessage('Video added to the report.');
          }
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
      <small>{allowFileSelection ? 'Capture with your camera or choose photos and videos from this device.' : 'Capture photos and videos with your camera.'} Up to five files, 50 MB each.</small>
    </div>
    {allowFileSelection && <>
      <input
        ref={fileInputRef}
        className="camera-evidence-file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/avif,video/mp4,video/webm,video/quicktime,video/3gpp,video/x-matroska"
        multiple
        onChange={(event) => addSelectedFiles(event.currentTarget.files)}
        aria-label="Choose photos or videos"
      />
      <button className="camera-evidence-open" type="button" onClick={() => fileInputRef.current?.click()}>
        <ImagePlus size={17} aria-hidden="true" /> Choose photo or video
      </button>
    </>}
    <button className="camera-evidence-open" type="button" onClick={() => void openCamera()}>
      <Camera size={17} aria-hidden="true" /> Open camera
    </button>
    {files.length > 0 && <ul className="camera-evidence-files" aria-label="Captured report evidence">
      {files.map((file, index) => <li key={`${file.name}-${file.lastModified}-${index}`}>
        <span><ImagePlus size={14} aria-hidden="true" />{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</span>
        <button type="button" onClick={() => removeFile(index)} aria-label={`Remove ${file.name}`}>Remove</button>
      </li>)}
    </ul>}
    {!cameraOpen && cameraMessage && <p className="camera-evidence-message" role="status">{cameraMessage}</p>}

    {cameraOpen && <div className="camera-capture-backdrop" role="presentation">
      <section className="camera-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="camera-capture-title">
        <header>
          <div><h2 id="camera-capture-title">Capture report evidence</h2><p>{allowFileSelection ? 'Take a photo or record a video, or choose media from your device.' : 'Take a photo or record a video.'}</p></div>
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
