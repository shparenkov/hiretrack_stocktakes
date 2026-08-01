import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  DecodeHintType,
  NotFoundException,
  Result,
} from '@zxing/library';
import bwipjs from 'bwip-js/browser';
import { BarcodeType } from '../types';

interface ScanResult {
  raw: string;
  barcodeType: BarcodeType;
}

interface OverlayBox {
  kind: 'line' | 'polygon';
  viewportWidth: number;
  viewportHeight: number;
  points: string;
}

interface BarcodeScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onUse: (result: ScanResult) => void;
}

function mapBcid(barcodeType: BarcodeType): string | null {
  switch (barcodeType) {
    case 'EAN13':
      return 'ean13';
    case 'CODE128':
      return 'code128';
    case 'CODE39':
      return 'code39';
    case 'DATAMATRIX':
      return 'datamatrix';
    case 'QR':
      return 'qrcode';
    default:
      return null;
  }
}

function mapBarcodeType(result: Result): BarcodeType {
  switch (result.getBarcodeFormat()) {
    case BarcodeFormat.EAN_13:
      return 'EAN13';
    case BarcodeFormat.CODE_128:
      return 'CODE128';
    case BarcodeFormat.CODE_39:
      return 'CODE39';
    case BarcodeFormat.DATA_MATRIX:
      return 'DATAMATRIX';
    case BarcodeFormat.QR_CODE:
      return 'QR';
    default:
      return 'OTHER';
  }
}

export function BarcodeScanner({ isOpen, onClose, onUse }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const previewSurfaceRef = useRef<HTMLDivElement | null>(null);
  const hasResolvedScanRef = useRef(false);
  const latestCandidateRef = useRef<ScanResult | null>(null);
  const lastSeenAtRef = useRef<number>(0);
  const lastOverlayKeyRef = useRef<string | null>(null);
  const lastStatusRef = useRef<string>('Point the camera at the equipment barcode.');
  const reader = useMemo(() => {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.EAN_13,
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.QR_CODE,
    ]);
    return new BrowserMultiFormatReader(hints);
  }, []);

  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [status, setStatus] = useState('Point the camera at the equipment barcode.');
  const [error, setError] = useState<string | null>(null);
  const [isBooting, setIsBooting] = useState(false);
  const [restartToken, setRestartToken] = useState(0);
  const [overlayBox, setOverlayBox] = useState<OverlayBox | null>(null);
  const [candidateResult, setCandidateResult] = useState<ScanResult | null>(null);

  function setStatusIfChanged(next: string) {
    if (lastStatusRef.current !== next) {
      lastStatusRef.current = next;
      setStatus(next);
    }
  }

  function computeOverlayBox(result: Result): OverlayBox | null {
    const points = result.getResultPoints();
    const video = videoRef.current;
    if (!video || !points || points.length === 0 || !video.videoWidth || !video.videoHeight) {
      return null;
    }

    const normalizedPoints = points
      .map((point) => ({ x: point.getX(), y: point.getY() }))
      .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (normalizedPoints.length === 0) {
      return null;
    }

    const viewportWidth = video.clientWidth;
    const viewportHeight = video.clientHeight;
    if (!viewportWidth || !viewportHeight) {
      return null;
    }

    const scale = Math.max(viewportWidth / video.videoWidth, viewportHeight / video.videoHeight);
    const renderedWidth = video.videoWidth * scale;
    const renderedHeight = video.videoHeight * scale;
    const cropX = (renderedWidth - viewportWidth) / 2;
    const cropY = (renderedHeight - viewportHeight) / 2;

    const viewPoints = normalizedPoints.map((point) => ({
      x: point.x * scale - cropX,
      y: point.y * scale - cropY,
    }));

    const visiblePoints = viewPoints.map((point) => ({
      x: Math.max(0, Math.min(viewportWidth, point.x)),
      y: Math.max(0, Math.min(viewportHeight, point.y)),
    }));

    const xs = visiblePoints.map((point) => point.x);
    const ys = visiblePoints.map((point) => point.y);

    const format = result.getBarcodeFormat();
    const isMatrix = format === BarcodeFormat.DATA_MATRIX || format === BarcodeFormat.QR_CODE;

    if (!isMatrix) {
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const midY = ys.reduce((sum, value) => sum + value, 0) / ys.length;

      return {
        kind: 'line',
        viewportWidth,
        viewportHeight,
        points: `${minX},${midY} ${maxX},${midY}`,
      };
    }

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const rawSize = Math.max(maxX - minX, maxY - minY);
    const size = rawSize * 1.85;
    const half = size / 2;

    const left = Math.max(0, centerX - half);
    const top = Math.max(0, centerY - half);
    const right = Math.min(video.videoWidth, centerX + half);
    const bottom = Math.min(video.videoHeight, centerY + half);

    return {
      kind: 'polygon',
      viewportWidth,
      viewportHeight,
      points: [
        `${left},${top}`,
        `${right},${top}`,
        `${right},${bottom}`,
        `${left},${bottom}`,
      ].join(' '),
    };
  }

  useEffect(() => {
    if (!isOpen) {
      reader.reset();
      hasResolvedScanRef.current = false;
      setScanResult(null);
      setStatusIfChanged('Point the camera at the equipment barcode.');
      setError(null);
      setIsBooting(false);
      setRestartToken(0);
      setOverlayBox(null);
      setCandidateResult(null);
      latestCandidateRef.current = null;
      lastSeenAtRef.current = 0;
      lastOverlayKeyRef.current = null;
      return;
    }

    if (scanResult) {
      reader.reset();
      setStatusIfChanged('Barcode captured. Review the graphic and use it or scan again.');
      return;
    }

    let isCancelled = false;

    async function startScanner() {
      if (!videoRef.current) {
        return;
      }

      if (!window.isSecureContext || !navigator.mediaDevices?.enumerateDevices) {
        setError('Camera access requires a secure context. Open this page over HTTPS or use manual serial entry.');
        setStatusIfChanged('Scanner unavailable on this connection.');
        return;
      }

      setIsBooting(true);
      setError(null);
      setStatusIfChanged('Starting camera...');

      try {
        const mediaDevices = await navigator.mediaDevices.enumerateDevices();
        const devices = mediaDevices.filter((device) => device.kind === 'videoinput');
        const preferredDeviceId =
          devices.find((device: MediaDeviceInfo) => /back|rear|environment/i.test(device.label))?.deviceId ??
          devices[0]?.deviceId;

        await reader.decodeFromVideoDevice(
          preferredDeviceId,
          videoRef.current,
          (result, caughtError) => {
            if (isCancelled) {
              return;
            }

            if (result) {
              const nextResult: ScanResult = {
                raw: result.getText(),
                barcodeType: mapBarcodeType(result),
              };
              const previousCandidate = latestCandidateRef.current;

              const isSameCandidate =
                previousCandidate?.raw === nextResult.raw &&
                previousCandidate?.barcodeType === nextResult.barcodeType;

              latestCandidateRef.current = nextResult;
              lastSeenAtRef.current = Date.now();

              if (!isSameCandidate) {
                const nextOverlay = computeOverlayBox(result);
                const nextOverlayKey = nextOverlay ? `${nextOverlay.kind}:${nextOverlay.points}` : null;

                setCandidateResult(nextResult);
                if (nextOverlayKey !== lastOverlayKeyRef.current) {
                  lastOverlayKeyRef.current = nextOverlayKey;
                  setOverlayBox(nextOverlay);
                }
                setError(null);
              }

              if (!hasResolvedScanRef.current) {
                hasResolvedScanRef.current = true;
                setScanResult(nextResult);
                setCandidateResult(null);
                setOverlayBox(null);
                lastOverlayKeyRef.current = null;
                setStatusIfChanged('Barcode captured. Review the graphic and use it or scan again.');
                reader.reset();
              } else if (!scanResult) {
                setStatusIfChanged('Barcode found in frame.');
              }
              return;
            }

            if (caughtError instanceof NotFoundException && !scanResult) {
              if (lastSeenAtRef.current && Date.now() - lastSeenAtRef.current > 1500) {
                latestCandidateRef.current = null;
                lastSeenAtRef.current = 0;
                setCandidateResult(null);
                setOverlayBox(null);
                lastOverlayKeyRef.current = null;
                setStatusIfChanged('Point the camera at the equipment barcode.');
              }
              return;
            }

            if (
              caughtError &&
              !(caughtError instanceof NotFoundException) &&
              !hasResolvedScanRef.current
            ) {
              setError(caughtError.message || 'Scanner error.');
            }
          },
        );

        if (!isCancelled) {
          setStatusIfChanged('Scanning for barcode...');
        }
      } catch (caught) {
        if (!isCancelled) {
          setError(caught instanceof Error ? caught.message : 'Camera is unavailable.');
          setStatusIfChanged('Scanner unavailable. Use manual serial entry.');
        }
      } finally {
        if (!isCancelled) {
          setIsBooting(false);
        }
      }
    }

    void startScanner();

    return () => {
      isCancelled = true;
      reader.reset();
    };
  }, [isOpen, onUse, reader, restartToken, scanResult]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas || !scanResult) {
      return;
    }

    const bcid = mapBcid(scanResult.barcodeType);
    if (!bcid) {
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      const width = 520;
      const height = 180;
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#142019';
      context.font = 'bold 22px Segoe UI';
      context.fillText(scanResult.barcodeType, 24, 48);
      context.font = '18px Segoe UI';
      context.fillText(scanResult.raw, 24, 94);
      return;
    }

    try {
      const options: Parameters<typeof bwipjs.toCanvas>[1] = {
        bcid,
        text: scanResult.raw,
        scale: 3,
        includetext: false,
        backgroundcolor: 'FFFFFF',
        paddingwidth: 12,
        paddingheight: 12,
      };

      if (scanResult.barcodeType !== 'DATAMATRIX' && scanResult.barcodeType !== 'QR') {
        options.height = 56;
      }

      bwipjs.toCanvas(canvas, options);

      const availableWidth = Math.max(1, (previewSurfaceRef.current?.clientWidth ?? 0) - 24);
      const availableHeight = Math.max(1, (previewSurfaceRef.current?.clientHeight ?? 0) - 24);
      const widthRatio = availableWidth / canvas.width;
      const heightRatio = availableHeight / canvas.height;
      const ratio = Math.min(1, widthRatio, heightRatio);
      canvas.style.width = `${Math.round(canvas.width * ratio)}px`;
      canvas.style.height = `${Math.round(canvas.height * ratio)}px`;
    } catch (caught) {
      const context = canvas.getContext('2d');
      if (!context) {
        return;
      }

      const width = 640;
      const height = 180;
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.fillStyle = '#8e1f1f';
      context.font = 'bold 18px Segoe UI';
      context.fillText('Barcode preview failed', 24, 40);
      context.fillStyle = '#142019';
      context.font = '16px Segoe UI';
      context.fillText(scanResult.raw, 24, 78);
      setError(caught instanceof Error ? caught.message : 'Barcode preview failed.');
    }
  }, [scanResult]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Barcode scanner">
      <div className="scanner-modal">
        <div className="scanner-header">
          <div>
            <h3>Scan Equipment Barcode</h3>
            <p>{status}</p>
          </div>
          <button type="button" className="scanner-ghost" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="scanner-body">
          <div className={`scanner-video-frame${scanResult ? ' is-success' : ''}`}>
            {scanResult ? (
              <div ref={previewSurfaceRef} className="scanner-preview-surface">
                <canvas ref={previewCanvasRef} className="scanner-preview-canvas" />
              </div>
            ) : (
              <>
                <video ref={videoRef} className="scanner-video" muted playsInline autoPlay />
                {overlayBox ? (
                  <svg
                    className="scanner-detected-overlay"
                    viewBox={`0 0 ${overlayBox.viewportWidth} ${overlayBox.viewportHeight}`}
                    preserveAspectRatio="none"
                  >
                    {overlayBox.kind === 'line' ? (
                      <polyline
                        className={`scanner-detected-line${candidateResult ? ' is-live' : ''}`}
                        points={overlayBox.points}
                      />
                    ) : (
                      <polygon
                        className={`scanner-detected-polygon${candidateResult ? ' is-live' : ''}`}
                        points={overlayBox.points}
                      />
                    )}
                  </svg>
                ) : null}
              </>
            )}
          </div>

          {error ? <div className="error-banner">{error}</div> : null}

          {scanResult ? (
            <div className="scanner-preview-caption">
              <strong>{scanResult.barcodeType}</strong>
              <div>{scanResult.raw}</div>
            </div>
          ) : null}
        </div>

        <div className="scanner-footer">
          <button
            type="button"
            className="scanner-ghost"
            onClick={() => {
              hasResolvedScanRef.current = false;
              setScanResult(null);
              setOverlayBox(null);
              setCandidateResult(null);
              latestCandidateRef.current = null;
              lastSeenAtRef.current = 0;
              lastOverlayKeyRef.current = null;
              setError(null);
              setStatusIfChanged('Point the camera at the equipment barcode.');
              reader.reset();
              setRestartToken((current) => current + 1);
            }}
            disabled={isBooting}
          >
            Scan Again
          </button>
          <button
            type="button"
            onClick={() => {
              if (scanResult) {
                onUse(scanResult);
                onClose();
              }
            }}
            disabled={!scanResult}
          >
            Use Barcode
          </button>
        </div>
      </div>
    </div>
  );
}
