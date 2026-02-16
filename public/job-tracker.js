// Global Job Tracker
// Tracks background AI jobs across page navigations using localStorage.
// Shows a badge in sidebar and toast notifications when jobs complete.

(function () {
  const STORAGE_KEY = '__tracked_jobs';
  const POLL_INTERVAL = 5000;
  let intervalId = null;

  function getTrackedJobs() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  }

  function saveTrackedJobs(jobs) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
  }

  function trackJob(jobId, label) {
    const jobs = getTrackedJobs();
    if (jobs.some(j => j.jobId === jobId)) return;
    jobs.push({ jobId, label: label || jobId, startedAt: new Date().toISOString() });
    saveTrackedJobs(jobs);
    updateBadge(jobs.length);
    ensurePolling();
  }

  function untrackJob(jobId) {
    const jobs = getTrackedJobs().filter(j => j.jobId !== jobId);
    saveTrackedJobs(jobs);
    updateBadge(jobs.length);
    if (jobs.length === 0) stopPolling();
  }

  function updateBadge(count) {
    const badge = document.getElementById('jobsBadge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = String(count);
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  function ensurePolling() {
    if (intervalId) return;
    intervalId = setInterval(pollJobs, POLL_INTERVAL);
  }

  function stopPolling() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  async function pollJobs() {
    const jobs = getTrackedJobs();
    if (jobs.length === 0) {
      stopPolling();
      return;
    }

    const remaining = [];

    for (const tracked of jobs) {
      try {
        const response = await fetch(`/api/jobs/${tracked.jobId}`);
        if (!response.ok) {
          // Job not found - remove from tracking
          continue;
        }

        const job = await response.json();

        if (job.status === 'completed') {
          if (typeof showToast === 'function') {
            showToast(`Job "${tracked.label}" bol dokončený!`, 'success', 6000);
          }
          // Don't add to remaining - it's done
        } else if (job.status === 'failed') {
          if (typeof showToast === 'function') {
            showToast(`Job "${tracked.label}" zlyhal.`, 'error', 6000);
          }
          // Don't add to remaining - it's done
        } else {
          // Still processing
          remaining.push(tracked);
        }
      } catch {
        // Network error - keep tracking
        remaining.push(tracked);
      }
    }

    saveTrackedJobs(remaining);
    updateBadge(remaining.length);

    if (remaining.length === 0) {
      stopPolling();
    }
  }

  // Initialize on page load
  document.addEventListener('DOMContentLoaded', () => {
    const jobs = getTrackedJobs();
    updateBadge(jobs.length);
    if (jobs.length > 0) {
      ensurePolling();
    }
  });

  // Expose global API
  window.trackJob = trackJob;
  window.untrackJob = untrackJob;
})();
