/* Native event registrations. Answers and files are submitted only to the private registration API. */
window.ercupsaRegistration = (() => {
  const receiptLimit = 4 * 1024 * 1024;
  const fullMessage = 'İlginiz için teşekkür ederiz. Kontenjanımız dolmuştur. Bir sonraki etkinliklerimize bekleriz.';
  const supportedTypes = new Set(['text', 'textarea', 'email', 'tel', 'select', 'radio', 'checkboxes', 'photo']);
  const choiceTypes = new Set(['select', 'radio', 'checkboxes']);
  const mounts = new WeakMap();
  const isOptionImage = value => {
    if (typeof value !== 'string' || value.length > 2000) return false;
    if (!value) return true;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'res.cloudinary.com'
        && !url.username && !url.password && !url.port && !url.hash && !url.search
        && url.pathname.startsWith('/w2trki15/image/upload/');
    } catch { return false; }
  };
  const photoFileError = file => {
    if (!file) return '';
    if (file.size > receiptLimit) return 'Dosya en fazla 4 MB olabilir.';
    if (!file.size) return 'Fotoğraf dosyası boş. Başka bir dosya seç.';
    const mime = file.type.toLowerCase();
    if (/\.svg$/i.test(file.name) || (mime.startsWith('image/') && !['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/jfif', 'image/png', 'image/x-png', 'image/webp'].includes(mime))) {
      return 'Fotoğraf için JPG, PNG veya WebP dosyası seç.';
    }
    // Android providers may leave the MIME empty or report a generic type.
    // The API checks the actual image bytes before accepting any upload.
    return '';
  };
  const endpoint = (action, eventId) => `/api/registrations?action=${encodeURIComponent(action)}&event_id=${encodeURIComponent(eventId)}`;
  const timedFetch = async (url, options = {}) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try { return await fetch(url, { ...options, signal: controller.signal }); }
    finally { clearTimeout(timer); }
  };
  const node = (tag, className, text) => {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text !== undefined) item.textContent = text;
    return item;
  };
  const requestId = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  function unavailable(container) {
    const message = node('div', 'registration-unavailable');
    message.id = 'nativeRegistrationUnavailable';
    message.setAttribute('role', 'status');
    message.append(node('h3', '', 'Bu etkinlik için kayıt alınmıyor'),
      node('p', '', 'Yeni kayıt duyuruları için etkinliklerimizi ve sosyal medya hesaplarımızı takip edebilirsin.'));
    container.replaceChildren(message);
  }

  function full(container, focus = false) {
    const message = node('div', 'registration-full');
    message.id = 'nativeRegistrationFull';
    message.setAttribute('role', 'status');
    message.tabIndex = -1;
    message.append(node('p', '', fullMessage));
    const back = node('a', 'event-secondary-action', 'Diğer etkinlikleri keşfet');
    back.href = 'etkinlikler.html';
    message.append(back);
    container.replaceChildren(message);
    if (focus) message.focus();
  }

  function validateConfig(config) {
    if (!config || !Array.isArray(config.fields) || config.fields.length < 3 || config.fields.length > 25) return false;
    const ids = new Set();
    const coreTypes = { full_name: 'text', class_year: 'select', phone: 'tel' };
    return config.fields.every(field => {
      if (!field || !/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(field.id) || ids.has(field.id)
        || ['__proto__', 'constructor', 'prototype'].includes(field.id)
        || !supportedTypes.has(field.type) || (Object.hasOwn(coreTypes, field.id) && coreTypes[field.id] !== field.type)
        || typeof field.label !== 'string' || !field.label.trim() || field.label.length > 160) return false;
      ids.add(field.id);
      if (!choiceTypes.has(field.type)) return field.optionImages === undefined;
      return Array.isArray(field.options) && field.options.length > 0
        && field.options.length <= 40 && field.options.every(value => typeof value === 'string' && value.trim() && value.length <= 160)
        && (field.optionImages === undefined || (Array.isArray(field.optionImages)
          && field.optionImages.length === field.options.length && field.optionImages.every(isOptionImage)));
    }) && ['full_name', 'class_year', 'phone'].every(id => ids.has(id));
  }

  function registrationSummary(result, event) {
    const snapshot = result.event && typeof result.event === 'object' ? result.event : event;
    const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit).trim() : '';
    const title = text(snapshot.title, 300) || text(event.title, 300) || 'Etkinlik';
    const date = text(typeof snapshot.date === 'string' ? snapshot.date : event.date, 10);
    const dateLabel = window.ercupsaEvents?.formatDate(date) || 'Tarih bilgisi paylaşılmadı.';
    const time = text(typeof snapshot.time === 'string' ? snapshot.time : event.time, 5);
    const timeLabel = /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? `${time} · Türkiye saati` : 'Saat bilgisi paylaşılmadı.';
    const location = text(typeof snapshot.location === 'string' ? snapshot.location : event.location, 500);
    const reference = text(result.reference, 120);
    const success = node('div', 'registration-success');
    success.id = 'registrationSuccess';
    success.setAttribute('role', 'status');
    success.tabIndex = -1;
    success.append(node('span', 'registration-success-mark', '✓'), node('h3', '', 'Kaydın alındı!'),
      node('p', '', 'Bilgilerin organizatörlere iletildi. Bu özeti saklayabilir, etkinlik duyurularını takip edebilirsin.'));
    const summary = node('section', 'registration-summary');
    summary.setAttribute('aria-labelledby', 'registrationSummaryTitle');
    const heading = node('h4', '', title);
    heading.id = 'registrationSummaryTitle';
    const facts = node('dl', 'registration-summary-facts');
    const fact = (label, value, id) => {
      const wrap = node('div');
      const content = node('dd', '', value);
      if (id) content.id = id;
      wrap.append(node('dt', '', label), content);
      facts.append(wrap);
    };
    fact('Tarih', dateLabel, 'registrationSummaryDate');
    fact('Saat', timeLabel, 'registrationSummaryTime');
    if (location) fact('Konum', location);
    if (reference) fact('Kayıt numaran', reference, 'registrationReference');
    summary.append(heading, facts);
    if (reference) {
      const savedText = ['ERCUPSA — Etkinlik kayıt özeti', `Etkinlik: ${title}`, `Tarih: ${dateLabel}`,
        `Saat: ${timeLabel}`, ...(location ? [`Konum: ${location}`] : []), `Kayıt numarası: ${reference}`,
        '', 'Bu kayıt numarası QR bilet kodu değildir. Bilet bilgisi organizatörler tarafından ayrıca paylaşılır.'].join('\n');
      const actions = node('div', 'registration-summary-actions');
      const copy = node('button', 'event-secondary-action', 'Kayıt numaramı kopyala');
      copy.type = 'button';
      copy.id = 'registrationCopyReference';
      const download = node('button', 'event-secondary-action', 'Özeti indir');
      download.type = 'button';
      download.id = 'registrationDownloadSummary';
      const feedback = node('p', 'registration-summary-status');
      feedback.id = 'registrationSummaryStatus';
      feedback.setAttribute('role', 'status');
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(reference);
          feedback.textContent = 'Kayıt numaran kopyalandı.';
        } catch {
          feedback.textContent = 'Otomatik kopyalama yapılamadı. Yukarıdaki kayıt numaranı seçip kopyalayabilir veya özeti indirebilirsin.';
        }
      });
      download.addEventListener('click', () => {
        const url = URL.createObjectURL(new Blob([savedText], { type: 'text/plain;charset=utf-8' }));
        const link = node('a');
        link.href = url;
        link.download = `ercupsa-kayit-${reference.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) || 'ozet'}.txt`;
        link.hidden = true;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      actions.append(copy, download);
      summary.append(actions, feedback);
    }
    summary.append(node('p', 'registration-summary-note', 'Bu kayıt numarası QR bilet kodu değildir. Bilet bilgisi organizatörler tarafından ayrıca paylaşılır.'));
    const back = node('a', 'event-secondary-action', 'Diğer etkinlikleri keşfet');
    back.href = 'etkinlikler.html';
    success.append(summary, back);
    return success;
  }

  function renderForm(container, config, event) {
    let pending = false;
    let disposed = false;
    const photoPreviews = new Map();
    const revokePreview = input => {
      const url = photoPreviews.get(input);
      if (url) URL.revokeObjectURL(url);
      photoPreviews.delete(input);
    };
    const dispose = () => {
      disposed = true;
      for (const input of photoPreviews.keys()) revokePreview(input);
    };
    const form = node('form', 'registration-form');
    form.id = 'nativeRegistrationForm';
    form.noValidate = true;
    const intro = node('div', 'registration-intro');
    const description = node('p', 'registration-description', config.description || 'Etkinliğe katılmak için aşağıdaki bilgileri doldur.');
    description.id = 'registrationDescription';
    intro.append(description, node('p', 'registration-required-note', '* işaretli alanların doldurulması zorunludur.'));
    if (config.receipt?.enabled || config.fields.some(field => field.type === 'photo')) {
      const budget = node('p', 'registration-upload-budget', 'Fotoğraflar ve dekont için toplam dosya sınırı 4 MB. Daha küçük dosyalar seçebilirsin.');
      budget.id = 'registrationUploadBudget';
      intro.append(budget);
    }
    form.append(intro);
    const fieldsContainer = node('div', 'registration-fields');
    const controls = new Map();

    for (const field of config.fields) {
      const imageChoices = choiceTypes.has(field.type) && field.optionImages?.some(Boolean);
      const grouped = field.type === 'radio' || field.type === 'checkboxes' || imageChoices;
      const wrap = node(grouped ? 'fieldset' : 'div', `registration-field${field.type === 'textarea' || field.type === 'photo' || imageChoices ? ' registration-field-wide' : ''}${field.type === 'photo' ? ' registration-photo' : ''}`);
      wrap.id = `registration-field-${field.id}`;
      const required = field.id === 'full_name' || field.required === true;
      const label = node(grouped ? 'legend' : 'label', 'registration-label', field.label);
      if (!grouped) label.htmlFor = `registration-${field.id}`;
      if (required) {
        const marker = node('span', 'registration-required', ' *');
        marker.setAttribute('aria-hidden', 'true');
        label.append(marker);
      }
      wrap.append(label);
      const inputs = [];
      let removePhoto, updatePhotoPreview;
      if (grouped) {
        const choices = node('div', `registration-choices${imageChoices ? ' registration-image-choices' : ''}`);
        for (const [index, option] of field.options.entries()) {
          const choice = node('label', `registration-choice${imageChoices ? ' registration-image-choice' : ''}`);
          const input = node('input');
          input.type = field.type === 'checkboxes' ? 'checkbox' : 'radio';
          input.name = field.id;
          input.id = `registration-${field.id}-${index}`;
          input.value = option;
          input.setAttribute('aria-describedby', `registration-error-${field.id}`);
          if (required) input.setAttribute('aria-required', 'true');
          if (imageChoices) {
            const media = node('div', 'registration-choice-media');
            const imageUrl = field.optionImages[index];
            if (imageUrl) {
              const image = node('img');
              image.src = imageUrl;
              image.alt = `${option} görseli`;
              image.loading = 'lazy';
              image.referrerPolicy = 'no-referrer';
              image.addEventListener('error', () => {
                image.remove();
                media.append(node('span', 'registration-choice-image-fallback', 'Görsel yüklenemedi'));
              }, { once: true });
              media.append(image);
            } else media.append(node('span', 'registration-choice-image-fallback', 'Görselsiz seçenek'));
            const caption = node('span', 'registration-choice-caption');
            const text = node('span', '', option);
            text.id = `registration-option-${field.id}-${index}`;
            input.setAttribute('aria-labelledby', text.id);
            caption.append(input, text);
            choice.append(media, caption);
          } else choice.append(input, node('span', '', option));
          choices.append(choice);
          inputs.push(input);
        }
        wrap.append(choices);
        if (imageChoices && field.type === 'select' && !required) {
          const clear = node('button', 'registration-choice-clear', 'Seçimi temizle');
          clear.type = 'button';
          clear.setAttribute('aria-label', `${field.label}: seçimi temizle`);
          clear.addEventListener('click', () => {
            if (pending || disposed) return;
            for (const input of inputs) input.checked = false;
            inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
            inputs[0].focus();
          });
          wrap.append(clear);
        }
      } else if (field.type === 'photo') {
        const help = node('p', 'registration-help', 'JPG, PNG veya WebP · Yalnızca etkinlik organizatörleri görüntüleyebilir. Fotoğraflar ve dekont toplam en fazla 4 MB olabilir.');
        help.id = `registration-help-${field.id}`;
        const input = node('input', 'registration-file');
        input.type = 'file';
        input.id = `registration-${field.id}`;
        input.name = `photo:${field.id}`;
        input.accept = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
        input.required = required;
        input.setAttribute('aria-describedby', `${help.id} registration-error-${field.id}`);
        const preview = node('div', 'registration-photo-preview hidden');
        const previewImage = node('img');
        previewImage.alt = `${field.label} için seçtiğin fotoğraf`;
        const previewStatus = node('p', 'registration-help');
        previewStatus.setAttribute('role', 'status');
        removePhoto = node('button', 'registration-photo-remove', 'Fotoğrafı kaldır');
        removePhoto.type = 'button';
        removePhoto.setAttribute('aria-label', `${field.label}: seçilen fotoğrafı kaldır`);
        previewImage.addEventListener('error', () => {
          previewImage.classList.add('hidden');
          previewStatus.textContent = 'Önizleme gösterilemiyor. Fotoğrafın dosya türü gönderildiğinde kontrol edilecek.';
        });
        const updatePreview = () => {
          revokePreview(input);
          previewImage.removeAttribute('src');
          previewImage.classList.add('hidden');
          previewStatus.textContent = '';
          const file = input.files?.[0];
          preview.classList.toggle('hidden', !file);
          if (!file) return;
          previewStatus.textContent = file.name;
          if (photoFileError(file)) return;
          const url = URL.createObjectURL(file);
          photoPreviews.set(input, url);
          previewImage.classList.remove('hidden');
          previewImage.src = url;
        };
        updatePhotoPreview = updatePreview;
        input.addEventListener('change', updatePreview);
        removePhoto.addEventListener('click', () => {
          if (pending || disposed) return;
          input.value = '';
          updatePreview();
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.focus();
        });
        preview.append(previewImage, previewStatus, removePhoto);
        wrap.append(help, input, preview);
        inputs.push(input);
      } else {
        const input = node(field.type === 'textarea' ? 'textarea' : field.type === 'select' ? 'select' : 'input', 'registration-control');
        input.name = field.id;
        input.id = `registration-${field.id}`;
        input.required = required;
        input.setAttribute('aria-describedby', `registration-error-${field.id}`);
        if (field.type === 'select') {
          const placeholder = node('option', '', 'Seçiniz');
          placeholder.value = '';
          input.append(placeholder);
          for (const value of field.options) {
            const option = node('option', '', value);
            option.value = value;
            input.append(option);
          }
        } else if (field.type === 'textarea') {
          input.rows = 4;
          input.maxLength = 2000;
        } else {
          input.type = field.type;
          input.maxLength = field.type === 'email' ? 254 : field.type === 'tel' ? 40 : 2000;
          if (field.id === 'full_name') input.autocomplete = 'name';
          else if (field.type === 'tel') {
            input.autocomplete = 'tel';
            input.inputMode = 'tel';
            input.placeholder = '05xx xxx xx xx';
          } else if (field.type === 'email') input.autocomplete = 'email';
        }
        wrap.append(input);
        inputs.push(input);
      }
      const error = node('p', 'registration-field-error hidden');
      error.id = `registration-error-${field.id}`;
      wrap.append(error);
      controls.set(field.id, { field, required, inputs, error, grouped, removePhoto, updatePhotoPreview });
      fieldsContainer.append(wrap);
    }
    form.append(fieldsContainer);

    let receiptInput, receiptError;
    if (config.receipt?.enabled) {
      const wrap = node('div', 'registration-receipt');
      const label = node('label', 'registration-label', 'Dekont');
      label.htmlFor = 'registrationReceipt';
      if (config.receipt.required) {
        const marker = node('span', 'registration-required', ' *');
        marker.setAttribute('aria-hidden', 'true');
        label.append(marker);
      }
      const note = node('p', 'registration-help', 'JPG, PNG veya PDF · En fazla 4 MB. Fotoğraflar ve dekont birlikte toplam 4 MB sınırına dahildir. Dosyanı yalnızca etkinlik organizatörleri görüntüleyebilir.');
      note.id = 'registrationReceiptHelp';
      receiptInput = node('input', 'registration-file');
      receiptInput.type = 'file';
      receiptInput.id = 'registrationReceipt';
      receiptInput.name = 'receipt';
      receiptInput.accept = 'image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf';
      receiptInput.required = config.receipt.required === true;
      receiptInput.setAttribute('aria-describedby', 'registrationReceiptHelp registration-error-receipt');
      receiptError = node('p', 'registration-field-error hidden');
      receiptError.id = 'registration-error-receipt';
      wrap.append(label, note, receiptInput, receiptError);
      form.append(wrap);
    }

    const trap = node('div', 'registration-honeypot');
    trap.setAttribute('aria-hidden', 'true');
    const trapLabel = node('label', '', 'Web sitesi');
    trapLabel.htmlFor = 'registrationWebsite';
    const trapInput = node('input');
    trapInput.type = 'text';
    trapInput.id = 'registrationWebsite';
    trapInput.name = 'website';
    trapInput.tabIndex = -1;
    trapInput.autocomplete = 'off';
    trap.append(trapLabel, trapInput);
    form.append(trap);

    const privacy = node('p', 'registration-privacy', 'Bilgilerin, varsa fotoğrafların ve dekontun bu etkinliğin kayıtlarını yönetmek amacıyla organizatörlere iletilir. Yüklediğin dosyalar sitede herkese açık paylaşılmaz. Kayıt için site hesabı oluşturman gerekmez.');
    const feedback = node('p', 'registration-feedback hidden');
    feedback.id = 'registrationFeedback';
    feedback.setAttribute('role', 'alert');
    feedback.tabIndex = -1;
    const submit = node('button', 'btn-primary registration-submit', 'Kaydımı gönder');
    submit.type = 'submit';
    submit.id = 'registrationSubmit';
    form.append(privacy, feedback, submit);
    container.replaceChildren(form);
    const idempotencyKey = requestId();

    const clearError = ({ inputs, error }) => {
      error.textContent = '';
      error.classList.add('hidden');
      inputs.forEach(input => input.removeAttribute('aria-invalid'));
    };
    const setError = ({ inputs, error }, message) => {
      error.textContent = message;
      error.classList.remove('hidden');
      inputs.forEach(input => input.setAttribute('aria-invalid', 'true'));
    };
    for (const control of controls.values()) {
      for (const input of control.inputs) input.addEventListener('input', () => clearError(control));
    }
    if (receiptInput) receiptInput.addEventListener('change', () => clearError({ inputs: [receiptInput], error: receiptError }));
    form.addEventListener('reset', () => queueMicrotask(() => {
      if (disposed) return;
      for (const control of controls.values()) {
        control.updatePhotoPreview?.();
        clearError(control);
      }
      if (receiptInput) clearError({ inputs: [receiptInput], error: receiptError });
    }));

    form.addEventListener('submit', async submission => {
      submission.preventDefault();
      if (pending || disposed) return;
      feedback.classList.add('hidden');
      feedback.textContent = '';
      const answers = Object.create(null);
      const photos = [];
      let firstInvalid;
      for (const control of controls.values()) {
        clearError(control);
        const { field, inputs, required, grouped } = control;
        if (field.type === 'photo') {
          const file = inputs[0].files?.[0];
          const error = required && !file ? 'Bu alan için bir fotoğraf yüklemelisin.' : photoFileError(file);
          if (error) {
            setError(control, error);
            firstInvalid ||= inputs[0];
          }
          if (file) photos.push({ control, file });
          continue;
        }
        const value = field.type === 'checkboxes'
          ? inputs.filter(input => input.checked).map(input => input.value)
          : grouped ? inputs.find(input => input.checked)?.value || '' : inputs[0].value.trim();
        answers[field.id] = value;
        let error = '';
        if (required && (Array.isArray(value) ? !value.length : !value)) error = 'Bu alanı doldurmalısın.';
        else if (value && field.type === 'email' && (inputs[0].validity.typeMismatch || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))) error = 'Geçerli bir e-posta adresi gir.';
        else if (value && field.type === 'tel' && (!/^\+?[\d\s().-]+$/.test(value) || !/^\d{10,15}$/.test(value.replace(/\D/g, '')))) {
          error = 'Telefon numaranı alan koduyla birlikte 10–15 rakam olarak gir.';
        }
        if (error) {
          setError(control, error);
          firstInvalid ||= inputs[0];
        }
      }
      const file = receiptInput?.files?.[0];
      if (receiptInput) {
        const control = { inputs: [receiptInput], error: receiptError };
        clearError(control);
        let error = '';
        if (config.receipt.required && !file) error = 'Dekont dosyanı yüklemelisin.';
        else if (file && file.size > receiptLimit) error = 'Dosya en fazla 4 MB olabilir.';
        // Android file providers can omit or mislabel MIME types and extensions.
        // Submit the original file; the server validates its actual JPG/PNG/PDF bytes.
        if (error) {
          setError(control, error);
          firstInvalid ||= receiptInput;
        }
      }
      const uploads = [...photos.map(photo => photo.file), ...(file ? [file] : [])];
      if (uploads.every(upload => upload.size <= receiptLimit)
        && uploads.reduce((total, upload) => total + upload.size, 0) > receiptLimit) {
        const control = photos[0]?.control || { inputs: [receiptInput], error: receiptError };
        setError(control, 'Fotoğraflar ve dekont toplam en fazla 4 MB olabilir. Daha küçük dosyalar seç.');
        firstInvalid ||= control.inputs[0];
      }
      if (firstInvalid) {
        feedback.textContent = 'İşaretli alanları kontrol edip tekrar deneyebilirsin.';
        feedback.classList.remove('hidden');
        firstInvalid.focus();
        return;
      }

      const payload = new FormData();
      payload.set('answers', JSON.stringify(answers));
      payload.set('requestId', idempotencyKey);
      payload.set('website', trapInput.value);
      if (file) payload.set('receipt', file, file.name);
      for (const { control, file: photo } of photos) payload.set(`photo:${control.field.id}`, photo, photo.name);
      pending = true;
      submit.disabled = true;
      submit.textContent = 'Kaydın gönderiliyor…';
      form.setAttribute('aria-busy', 'true');
      // Keep the exact submitted values visible while the request is pending.
      const editable = [...form.querySelectorAll('input, textarea, select, button')].filter(input => input !== submit);
      editable.forEach(input => { input.disabled = true; });
      try {
        const response = await timedFetch(endpoint('submit', event.id), { method: 'POST', body: payload });
        let result;
        try { result = await response.json(); } catch {}
        if (disposed) return;
        if (!response.ok || result?.ok !== true) {
          if (response.status === 409 && result?.code === 'REGISTRATION_FULL') {
            dispose();
            return full(container, true);
          }
          if (response.status === 409 || response.status === 404) {
            throw new Error(typeof result?.error === 'string' ? result.error
              : 'Bu etkinlik için artık kayıt alınmıyor. Girdiğin bilgiler gönderilemedi.');
          }
          if (response.status === 429) throw new Error('Çok sık kayıt denemesi yapıldı. Biraz bekleyip tekrar deneyebilirsin.');
          throw new Error(typeof result?.error === 'string' ? result.error : 'Kaydın gönderilemedi. Bilgilerini koruduk; tekrar deneyebilirsin.');
        }
        const success = registrationSummary(result, event);
        dispose();
        container.replaceChildren(success);
        success.focus();
      } catch (error) {
        if (disposed) return;
        feedback.textContent = error.name === 'AbortError'
          ? 'Sunucudan yanıt alınamadı. Bilgilerini koruduk; tekrar deneyebilirsin.'
          : error instanceof TypeError
          ? 'Bağlantı kurulamadı. Bilgilerini koruduk; bağlantını kontrol edip tekrar deneyebilirsin.'
          : error.message || 'Kaydın gönderilemedi. Tekrar deneyebilirsin.';
        feedback.classList.remove('hidden');
        feedback.focus();
      } finally {
        pending = false;
        submit.disabled = false;
        submit.textContent = 'Kaydımı gönder';
        form.removeAttribute('aria-busy');
        editable.forEach(input => { input.disabled = false; });
      }
    });
    return dispose;
  }

  async function mount({ event, container }) {
    mounts.get(container)?.dispose?.();
    const state = { dispose: null };
    mounts.set(container, state);
    const loading = node('p', 'registration-loading', 'Kayıt formu yükleniyor…');
    loading.setAttribute('role', 'status');
    container.replaceChildren(loading);
    try {
      const response = await timedFetch(endpoint('form', event.id));
      let data;
      try { data = await response.json(); } catch {}
      if (mounts.get(container) !== state) return;
      if ((response.ok && data?.full === true) || (response.status === 409 && data?.code === 'REGISTRATION_FULL')) return full(container);
      if (response.status === 404 || response.status === 409) return unavailable(container);
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Kayıt formu şu anda yüklenemedi. Tekrar deneyebilirsin.');
      if (!data) throw new Error('Kayıt formu bilgileri okunamadı. Tekrar deneyebilirsin.');
      if (!data.available || !data.form?.enabled) return unavailable(container);
      if (!validateConfig(data.form)) throw new Error('Form bilgileri geçersiz.');
      state.dispose = renderForm(container, data.form, event);
    } catch (error) {
      if (mounts.get(container) !== state) return;
      const errorState = node('div', 'registration-load-error');
      const message = node('p', '', error.name === 'AbortError'
        ? 'Kayıt formu zamanında yüklenemedi. Tekrar deneyebilirsin.'
        : error instanceof TypeError
        ? 'Kayıt formu şu anda yüklenemedi. Bağlantını kontrol edip tekrar deneyebilirsin.'
        : error.message || 'Kayıt formu şu anda yüklenemedi. Tekrar deneyebilirsin.');
      message.id = 'registrationFeedback';
      message.setAttribute('role', 'alert');
      const retry = node('button', 'event-secondary-action', 'Tekrar dene');
      retry.type = 'button';
      retry.id = 'nativeFormRetry';
      retry.addEventListener('click', () => mount({ event, container }));
      errorState.append(message, retry);
      container.replaceChildren(errorState);
    }
  }
  return { mount };
})();
