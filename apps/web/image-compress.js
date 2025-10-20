/**
 * Client-side image compression and validation for FinishLine
 * Prevents server FUNCTION_INVOCATION_FAILED by catching oversized images early
 */

const MAX_IMAGES = 6;
const MAX_EDGE = 1400; // Max width/height in pixels
const MAX_TOTAL_MB = 3.5; // Total payload limit
const JPEG_QUALITY = 0.85; // JPEG compression quality

/**
 * Validate file is an acceptable image
 * @param {File} file - File to validate
 * @returns {Object} {valid: boolean, error: string}
 */
function validateFile(file) {
  // Check file type
  if (!file.type.startsWith("image/")) {
    return {
      valid: false,
      error: `"${file.name}" is not an image file`
    };
  }
  
  // Reject unsupported formats
  const supportedTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];
  if (!supportedTypes.includes(file.type.toLowerCase())) {
    return {
      valid: false,
      error: `"${file.name}" format not supported. Use JPEG, PNG, or WebP.`
    };
  }
  
  // Check individual file size (before compression)
  const sizeMB = file.size / (1024 * 1024);
  if (sizeMB > 10) {
    return {
      valid: false,
      error: `"${file.name}" is too large (${sizeMB.toFixed(1)}MB). Maximum 10MB per image.`
    };
  }
  
  return { valid: true };
}

/**
 * Validate array of files
 * @param {File[]} files - Files to validate
 * @returns {Object} {valid: boolean, error: string}
 */
function validateFiles(files) {
  if (!files || files.length === 0) {
    return {
      valid: false,
      error: "No files selected"
    };
  }
  
  if (files.length > MAX_IMAGES) {
    return {
      valid: false,
      error: `Too many images (${files.length}). Maximum is ${MAX_IMAGES}.`
    };
  }
  
  // Validate each file
  for (const file of files) {
    const result = validateFile(file);
    if (!result.valid) {
      return result;
    }
  }
  
  return { valid: true };
}

/**
 * Load image from File object
 * @param {File} file - Image file
 * @returns {Promise<HTMLImageElement>}
 */
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    
    img.src = url;
  });
}

/**
 * Compress and resize image
 * @param {HTMLImageElement} img - Image element
 * @param {number} maxEdge - Maximum width/height
 * @param {number} quality - JPEG quality (0-1)
 * @returns {Promise<Blob>} Compressed image blob
 */
async function compressImage(img, maxEdge = MAX_EDGE, quality = JPEG_QUALITY) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  
  // Calculate new dimensions
  let { width, height } = img;
  if (width > maxEdge || height > maxEdge) {
    const scale = maxEdge / Math.max(width, height);
    width = Math.floor(width * scale);
    height = Math.floor(height * scale);
  }
  
  canvas.width = width;
  canvas.height = height;
  
  // Draw and compress
  ctx.drawImage(img, 0, 0, width, height);
  
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

/**
 * Convert blob to base64 data URL
 * @param {Blob} blob - Image blob
 * @returns {Promise<string>} Data URL
 */
function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Process single file: validate, compress, convert to data URL
 * @param {File} file - Image file
 * @param {Function} onProgress - Progress callback (optional)
 * @returns {Promise<Object>} {dataURL: string, originalSize: number, compressedSize: number}
 */
async function processFile(file, onProgress = null) {
  // Validate
  const validation = validateFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const originalSize = file.size;
  
  if (onProgress) onProgress({ stage: "loading", percent: 10 });
  
  // Load image
  const img = await loadImage(file);
  
  if (onProgress) onProgress({ stage: "compressing", percent: 40 });
  
  // Compress
  const blob = await compressImage(img);
  const compressedSize = blob.size;
  
  if (onProgress) onProgress({ stage: "encoding", percent: 70 });
  
  // Convert to data URL
  const dataURL = await blobToDataURL(blob);
  
  if (onProgress) onProgress({ stage: "done", percent: 100 });
  
  console.log(
    `[Image] Processed "${file.name}": ` +
    `${(originalSize / 1024).toFixed(0)}KB → ${(compressedSize / 1024).toFixed(0)}KB ` +
    `(${((compressedSize / originalSize) * 100).toFixed(0)}%)`
  );
  
  return {
    dataURL,
    originalSize,
    compressedSize,
    filename: file.name
  };
}

/**
 * Process multiple files with total size validation
 * @param {File[]} files - Array of image files
 * @param {Function} onProgress - Progress callback (file index, total)
 * @returns {Promise<Object[]>} Array of processed images
 */
async function processFiles(files, onProgress = null) {
  // Validate all files first
  const validation = validateFiles(files);
  if (!validation.valid) {
    throw new Error(validation.error);
  }
  
  const results = [];
  let totalSize = 0;
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    
    if (onProgress) {
      onProgress({ fileIndex: i, totalFiles: files.length, filename: file.name });
    }
    
    const result = await processFile(file);
    results.push(result);
    
    totalSize += result.compressedSize;
    
    // Check total size
    const totalMB = totalSize / (1024 * 1024);
    if (totalMB > MAX_TOTAL_MB) {
      throw new Error(
        `Total image size too large (${totalMB.toFixed(1)}MB). Maximum is ${MAX_TOTAL_MB}MB. ` +
        `Try reducing image count or quality.`
      );
    }
  }
  
  console.log(
    `[Image] Processed ${results.length} images, ` +
    `total ${(totalSize / 1024).toFixed(0)}KB (${(totalSize / (1024 * 1024)).toFixed(2)}MB)`
  );
  
  return results;
}

/**
 * Quick validation without processing
 * @param {File[]} files - Files to validate
 * @returns {Object} {valid: boolean, error: string, warnings: string[]}
 */
function quickValidate(files) {
  const result = validateFiles(files);
  if (!result.valid) {
    return result;
  }
  
  const warnings = [];
  let totalSize = 0;
  
  for (const file of files) {
    totalSize += file.size;
    
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 5) {
      warnings.push(`"${file.name}" is large (${sizeMB.toFixed(1)}MB) and will be compressed`);
    }
  }
  
  const totalMB = totalSize / (1024 * 1024);
  if (totalMB > MAX_TOTAL_MB * 2) {
    warnings.push(
      `Total size is large (${totalMB.toFixed(1)}MB). ` +
      `Images will be compressed to ~${MAX_TOTAL_MB}MB`
    );
  }
  
  return {
    valid: true,
    warnings
  };
}

// Export for use in app.js
window.ImageCompress = {
  validateFile,
  validateFiles,
  processFile,
  processFiles,
  quickValidate,
  MAX_IMAGES,
  MAX_EDGE,
  MAX_TOTAL_MB
};

