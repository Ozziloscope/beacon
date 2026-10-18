(function () {
  'use strict';

  // ------------------------------------------------------- profile photo
  var editor = document.querySelector('[data-avatar-editor]');
  if (editor) {
    var input = editor.querySelector('[data-avatar-input]');
    var pick = editor.querySelector('[data-avatar-pick]');
    var errorEl = editor.querySelector('[data-avatar-error]');
    var preview = editor.querySelector('.avatar-preview');
    var csrf = document.querySelector('input[name="_csrf"]').value;
    var SIZE = 512;

    function showError(msg) { errorEl.textContent = msg; errorEl.hidden = !msg; }

    // Center-crop to a square and resize so every avatar is small and consistent.
    function squareCrop(file) {
      if (file.type === 'image/gif' || !window.createImageBitmap) return Promise.resolve(file);
      return createImageBitmap(file).then(function (bmp) {
        var side = Math.min(bmp.width, bmp.height);
        var out = Math.min(SIZE, side);
        var canvas = document.createElement('canvas');
        canvas.width = canvas.height = out;
        canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, out, out);
        bmp.close && bmp.close();
        return new Promise(function (resolve) {
          canvas.toBlob(function (blob) {
            if (blob && blob.type === 'image/webp') resolve(blob);
            else canvas.toBlob(function (jpg) { resolve(jpg || file); }, 'image/jpeg', 0.9);
          }, 'image/webp', 0.9);
        });
      });
    }

    pick.addEventListener('click', function () { input.click(); });
    input.addEventListener('change', function () {
      var file = input.files[0];
      input.value = '';
      if (!file) return;
      if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) { showError('Use a PNG, JPEG, GIF or WebP image.'); return; }
      showError('');
      pick.disabled = true;
      pick.lastChild.textContent = 'Uploading…';
      squareCrop(file).then(function (blob) {
        if (blob.size > 5 * 1024 * 1024) throw new Error('That image is over 5 MB. Pick a smaller one.');
        var local = URL.createObjectURL(blob);
        preview.innerHTML = '<img class="avatar" src="' + local + '" alt="" width="112" height="112" style="--size:112px">';
        return fetch('/api/account/avatar', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': blob.type, 'X-CSRF-Token': csrf },
          body: blob,
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          if (!res.ok) throw new Error(d.error || 'Upload failed.');
          window.location.reload();
        });
      }).catch(function (err) {
        showError(err.message || 'Upload failed.');
        pick.disabled = false;
        pick.lastChild.textContent = 'Upload photo';
      });
    });
  }

  // ---------------------------------------------------- extra contact rows
  var rows = document.querySelector('[data-contact-rows]');
  var add = document.querySelector('[data-add-contact]');
  if (rows && add) {
    add.addEventListener('click', function () {
      if (rows.children.length >= 10) { add.disabled = true; return; }
      var row = rows.lastElementChild.cloneNode(true);
      Array.prototype.forEach.call(row.querySelectorAll('input'), function (i) { i.value = ''; });
      rows.appendChild(row);
      row.querySelector('input').focus();
      if (rows.children.length >= 10) add.disabled = true;
    });
  }
})();
