
/**
 * Checks if a URL is a YouTube URL
 * @param {string} url - URL to check
 * @returns {boolean} - Whether the URL is from YouTube
 */
function isYouTubeUrl(url) {
  try {
    const urlObj = new URL(url);
    return (
      urlObj.hostname === "www.youtube.com" ||
      urlObj.hostname === "youtube.com" ||
      urlObj.hostname === "youtu.be" ||
      urlObj.hostname === "m.youtube.com"
    );
  } catch {
    return false;
  }
}

/**
 * Checks if a YouTube URL is a channel URL (not a specific video)
 * @param {string} url - YouTube URL to check
 * @returns {boolean} - Whether the URL is a channel URL
 */
function isYouTubeChannelUrl(url) {
  try {
    const urlObj = new URL(url);
    // Channel URLs contain /@, /c/, /channel/, or /user/
    return (
      urlObj.pathname.includes("/@") ||
      urlObj.pathname.includes("/c/") ||
      urlObj.pathname.includes("/channel/") ||
      urlObj.pathname.includes("/user/")
    );
  } catch {
    return false;
  }
}

/**
 * Validates a YouTube URL
 * - For channel URLs: uses simple HEAD request (channels are stable)
 * - For video URLs: uses oEmbed API to verify video exists
 * @param {string} url - YouTube URL to validate
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} - Whether the URL is valid
 */
async function validateYouTubeUrl(url, timeout = 5000) {
  try {
    // Channel URLs are generally stable, just do a simple check
    if (isYouTubeChannelUrl(url)) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        redirect: "follow",
      });

      clearTimeout(timeoutId);
      return response.status >= 200 && response.status < 400;
    }

    // For video URLs, use oEmbed API
    const oEmbedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      url
    )}&format=json`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(oEmbedUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
      },
    });

    clearTimeout(timeoutId);

    // oEmbed returns 200 for valid public videos, 401/404 for invalid/private
    if (response.status === 200) {
      try {
        const data = await response.json();
        return !!(data.title && data.author_name);
      } catch {
        return false;
      }
    }

    return false;
  } catch (error) {
    console.log(`YouTube validation failed for ${url}:`, error.message);
    return false;
  }
}

/**
 * Validates a URL by making a HEAD request with retries
 * Uses special handling for YouTube videos via oEmbed API
 * @param {string} url - URL to validate
 * @param {number} maxRetries - Maximum retry attempts
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<boolean>} - Whether the URL is valid
 */
async function validateUrl(url, maxRetries = 3, timeout = 5000) {
  // Special handling for YouTube URLs
  if (isYouTubeUrl(url)) {
    // For YouTube, use specialized validation
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const isValid = await validateYouTubeUrl(url, timeout);
      if (isValid) {
        return true;
      }
      // Exponential backoff before retry
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 100)
        );
      }
    }
    return false;
  }

  // Standard URL validation for non-YouTube URLs
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      const response = await fetch(url, {
        method: "HEAD",
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
        redirect: "follow",
      });

      clearTimeout(timeoutId);

      // Accept 2xx and 3xx status codes
      if (response.status >= 200 && response.status < 400) {
        return true;
      }

      // Some servers don't support HEAD, try GET
      if (response.status === 405 || response.status === 403) {
        const getResponse = await fetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(timeout),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9",
          },
          redirect: "follow",
        });
        if (getResponse.status >= 200 && getResponse.status < 400) {
          return true;
        }
      }
    } catch (error) {
      // Exponential backoff before retry
      if (attempt < maxRetries) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.pow(2, attempt) * 100)
        );
      }
    }
  }
  return false;
}

/**
 * Validates multiple URLs in parallel with concurrency limit
 * Used to validate resources in parallel
 * @param {Array} resources - Array of resource objects with url property
 * @param {number} concurrency - Max concurrent validations
 * @returns {Promise<Array>} - Array of validated resources
 */
async function validateResourcesInParallel(resources, concurrency = 5) {
  const validatedResources = [];
  const chunks = [];

  // Split into chunks for controlled concurrency
  for (let i = 0; i < resources.length; i += concurrency) {
    chunks.push(resources.slice(i, i + concurrency));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (resource) => {
        const isValid = await validateUrl(resource.url);
        return { ...resource, isValid };
      })
    );

    validatedResources.push(...results.filter((r) => r.isValid));
  }

  return validatedResources.map(({ isValid, ...rest }) => rest);
}

module.exports = {
  isYouTubeUrl,
  isYouTubeChannelUrl,
  validateYouTubeUrl,
  validateUrl,
  validateResourcesInParallel,
};
