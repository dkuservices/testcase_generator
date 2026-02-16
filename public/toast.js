/* Toast Notification & Confirm Modal System */

(function () {
  'use strict';

  let container = null;

  function ensureContainer() {
    if (!container || !container.isConnected) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  /**
   * Show a toast notification.
   * @param {string} message - The message to display
   * @param {'success'|'error'|'warning'|'info'} [type='info'] - Toast type
   * @param {number} [duration=4000] - Auto-dismiss time in ms (0 = no auto-dismiss)
   */
  window.showToast = function showToast(message, type, duration) {
    type = type || 'info';
    duration = duration !== undefined ? duration : 4000;

    const c = ensureContainer();
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.innerHTML =
      '<span>' + escapeHtml(message) + '</span>' +
      '<button class="toast-close" aria-label="Zavrieť">&times;</button>';

    const closeBtn = el.querySelector('.toast-close');
    closeBtn.addEventListener('click', function () { removeToast(el); });

    c.appendChild(el);

    if (duration > 0) {
      setTimeout(function () { removeToast(el); }, duration);
    }
  };

  function removeToast(el) {
    if (!el || !el.isConnected || el.classList.contains('removing')) return;
    el.classList.add('removing');
    el.addEventListener('animationend', function () { el.remove(); });
  }

  /**
   * Show a confirmation modal.
   * @param {string} message - The message to display
   * @param {string} [confirmText='Potvrdiť'] - Confirm button text
   * @param {string} [cancelText='Zrušiť'] - Cancel button text
   * @param {boolean} [danger=false] - Style confirm button as danger
   * @returns {Promise<boolean>} Resolves true if confirmed, false otherwise
   */
  window.showConfirm = function showConfirm(message, confirmText, cancelText, danger) {
    confirmText = confirmText || 'Potvrdiť';
    cancelText = cancelText || 'Zrušiť';

    return new Promise(function (resolve) {
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML =
        '<div class="confirm-modal">' +
          '<p>' + escapeHtml(message) + '</p>' +
          '<div class="confirm-actions">' +
            '<button class="confirm-cancel">' + escapeHtml(cancelText) + '</button>' +
            '<button class="confirm-ok' + (danger ? ' danger' : '') + '">' + escapeHtml(confirmText) + '</button>' +
          '</div>' +
        '</div>';

      function close(result) {
        overlay.classList.add('removing');
        overlay.addEventListener('animationend', function () { overlay.remove(); });
        document.removeEventListener('keydown', onKey);
        resolve(result);
      }

      function onKey(e) {
        if (e.key === 'Escape') close(false);
      }

      overlay.querySelector('.confirm-cancel').addEventListener('click', function () { close(false); });
      overlay.querySelector('.confirm-ok').addEventListener('click', function () { close(true); });
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close(false);
      });
      document.addEventListener('keydown', onKey);

      document.body.appendChild(overlay);
      overlay.querySelector('.confirm-ok').focus();
    });
  };

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
})();
