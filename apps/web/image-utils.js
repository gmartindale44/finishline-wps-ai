/**
 * Client-side image compression utilities
 * Reduces upload size and prevents server overload
 */

/**
 * Compress and resize image file to base64
 * @param {File} file - Image file to compress
 * @param {Object} options - Compression options
 * @param {number} options.maxWidth - Maximum width (default: 1400px)
 * @param {number} options.maxHeight - Maximum height (default: 1400px)
 * @param {number} options.quality - JPEG quality 0-1 (default: 0.8)
 * @returns {Promise<{dataURL: string, originalSize: number, compressedSize: number, ratio: number}>}
 */
async function compressImageToBase64(file, options = {}) {
  const {
    maxWidth = 1400,
    maxHeight = 1400,
    quality = 0.8
  } = options;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    
    reader.onload = (e) => {
      const img = new Image();
      
      img.onerror = () => reject(new Error('Failed to load image'));
      
      img.onload = () => {
        try {
          // Calculate new dimensions while preserving aspect ratio
          const ratio = Math.min(
            1,
            maxWidth / img.naturalWidth,
            maxHeight / img.naturalHeight
          );
          
          const newWidth = Math.max(1, Math.floor(img.naturalWidth * ratio));
          const newHeight = Math.max(1, Math.floor(img.naturalHeight * ratio));
          
          // Create canvas and draw resized image
          const canvas = document.createElement('canvas');
          canvas.width = newWidth;
          canvas.height = newHeight;
          
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Failed to get canvas context'));
            return;
          }
          
          // Use high-quality image smoothing
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          
          // Draw the resized image
          ctx.drawImage(img, 0, 0, newWidth, newHeight);
          
          // Convert to JPEG with specified quality (much smaller than PNG)
          const dataURL = canvas.toDataURL('image/jpeg', quality);
          
          // Calculate sizes
          const originalSize = file.size;
          const compressedSize = Math.ceil((dataURL.length - dataURL.indexOf(',') - 1) * 0.75);
          const compressionRatio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
          
          console.log(`🗜️ Image compressed: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${compressionRatio}% reduction)`);
          
          resolve({
            dataURL,
            originalSize,
            compressedSize,
            ratio: compressionRatio
          });
        } catch (err) {
          reject(err);
        }
      };
      
      img.src = e.target.result;
    };
    
    reader.readAsDataURL(file);
  });
}

/**
 * Validate image size before upload
 * @param {string} dataURL - Base64 data URL
 * @param {number} maxMB - Maximum size in megabytes
 * @returns {{valid: boolean, sizeMB: number, error?: string}}
 */
function validateImageSize(dataURL, maxMB = 5.0) {
  // Strip data URL prefix and calculate actual byte size
  const base64Data = dataURL.replace(/^data:image\/\w+;base64,/, '');
  const estimatedBytes = Math.ceil(base64Data.length * 0.75);
  const sizeMB = estimatedBytes / (1024 * 1024);
  
  if (sizeMB > maxMB) {
    return {
      valid: false,
      sizeMB: parseFloat(sizeMB.toFixed(2)),
      error: `Image is ${sizeMB.toFixed(2)}MB. Maximum allowed is ${maxMB}MB.`
    };
  }
  
  return {
    valid: true,
    sizeMB: parseFloat(sizeMB.toFixed(2))
  };
}

/**
 * Get file size in human-readable format
 * @param {number} bytes
 * @returns {string}
 */
function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

// Export for use in main app
window.ImageUtils = {
  compressImageToBase64,
  validateImageSize,
  formatFileSize
};

