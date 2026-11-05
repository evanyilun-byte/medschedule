// Free, on-device text reading with Tesseract.js. The photo never leaves
// the phone; the first scan downloads the reader (~5 MB), later scans reuse it.
const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

let workerPromise = null;
let onProgress = () => {};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Could not load the label reader. Check your internet connection and try again.'));
    document.head.appendChild(s);
  });
}

function getWorker() {
  workerPromise ??= loadScript(TESSERACT_URL)
    .then(() =>
      window.Tesseract.createWorker('eng', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
        },
      }),
    )
    .catch((err) => {
      workerPromise = null; // allow a retry
      throw err;
    });
  return workerPromise;
}

// Grey, high-contrast and around 2000px wide reads noticeably better.
function prepareImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(2, 2000 / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.filter = 'grayscale(1) contrast(1.6)';
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('That file is not a photo the app can open.'));
    img.src = URL.createObjectURL(file);
  });
}

export async function recognizeLabel(file, progress = () => {}) {
  onProgress = progress;
  const [worker, canvas] = await Promise.all([getWorker(), prepareImage(file)]);
  const { data } = await worker.recognize(canvas);
  return { text: data.text, confidence: data.confidence };
}
