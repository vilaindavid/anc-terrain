/**
 * PhotoCapture
 *
 * Opens the device camera (or file picker as fallback) and stores the image
 * as a base64 dataUrl in IndexedDB via addPhoto().
 *
 * Props
 * ─────
 * sessionId  string
 * nodeId     string
 * balise     string   docx placeholder associated with this node
 * onCapture  fn       called with the new photo record after save
 */

import { useRef } from 'react';
import { addPhoto } from '../data/db.js';

export default function PhotoCapture({ sessionId, nodeId, balise, onCapture }) {
  const inputRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Generate filename: {id_dossier}_{balise}_{NN}.jpg  (NN resolved by caller)
    const ext      = file.name.split('.').pop() || 'jpg';
    const filename = `${sessionId}_${balise || nodeId}_photo.${ext}`;

    // Read as dataUrl for offline storage
    const dataUrl = await _readAsDataUrl(file);
    const photoId = await addPhoto({ sessionId, nodeId, balise, filename, mimeType: file.type, dataUrl });

    onCapture?.({ id: photoId, sessionId, nodeId, balise, filename, mimeType: file.type, dataUrl });

    // Reset input so the same file can be re-selected if needed
    e.target.value = '';
  };

  return (
    <>
      {/* Hidden file input — accept images, prefer camera on mobile */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"   /* rear camera on mobile */
        style={{ display: 'none' }}
        onChange={handleFile}
      />
      <button
        className="btn btn-ghost"
        style={{ minHeight: 48 }}
        onClick={() => inputRef.current?.click()}
      >
        📷 Photo
      </button>
    </>
  );
}

function _readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
