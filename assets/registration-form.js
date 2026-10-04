/* Native event registrations. Answers and receipts are submitted only to the private registration API. */
window.ercupsaRegistration = (() => {
  const receiptLimit = 4 * 1024 * 1024;
  const fullMessage = 'İlginiz için teşekkür ederiz. Kontenjanımız dolmuştur. Bir sonraki etkinliklerimize bekleriz.';
  const supportedTypes = new Set(['text', 'textarea', 'email', 'tel', 'select', 'radio', 'checkboxes']);
  const choiceTypes = new Set(['select', 'radio', 'checkboxes']);
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
      return !choiceTypes.has(field.type) || (Array.isArray(field.options) && field.options.length > 0
        && field.options.length <= 40 && field.options.every(value => typeof value === 'string' && value.trim() && value.length <= 160));
    }) && ['full_name', 'class_year', 'phone'].every(id => ids.has(id));
  }

  function renderForm(container, config, event) {
    const form = node('form', 'registration-form');
    form.id = 'nativeRegistrationForm';
    form.noValidate = true;
    const intro = node('div', 'registration-intro');
    const description = node('p', 'registration-description', config.description || 'Etkinliğe katılmak için aşağıdaki bilgileri doldur.');
    description.id = 'registrationDescription';
    intro.append(description, node('p', 'registration-required-note', '* işaretli alanların doldurulması zorunludur.'));
    form.append(intro);
    const fieldsContainer = node('div', 'registration-fields');
    const controls = new Map();

    for (const field of config.fields) {
      const grouped = field.type === 'radio' || field.type === 'checkboxes';
      const wrap = node(grouped ? 'fieldset' : 'div', `registration-field${field.type === 'textarea' ? ' registration-field-wide' : ''}`);
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
      if (grouped) {
        const choices = node('div', 'registration-choices');
        for (const [index, option] of field.options.entries()) {
          const choice = node('label', 'registration-choice');
          const input = node('input');
          input.type = field.type === 'checkboxes' ? 'checkbox' : 'radio';
          input.name = field.id;
          input.id = `registration-${field.id}-${index}`;
          input.value = option;
          input.setAttribute('aria-describedby', `registration-error-${field.id}`);
          if (required) input.setAttribute('aria-required', 'true');
          choice.append(input, node('span', '', option));
          choices.append(choice);
          inputs.push(input);
        }
        wrap.append(choices);
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
      controls.set(field.id, { field, required, inputs, error });
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
      const note = node('p', 'registration-help', 'JPG, PNG veya PDF · En fazla 4 MB. Dosyanı yalnızca etkinlik organizatörleri görüntüleyebilir.');
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

    const privacy = node('p', 'registration-privacy', 'Bilgilerin ve varsa dekontun bu etkinliğin kayıtlarını yönetmek amacıyla organizatörlere iletilir. Kayıt için site hesabı oluşturman gerekmez.');
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
    let pending = false;

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

    form.addEventListener('submit', async submission => {
      submission.preventDefault();
      if (pending) return;
      feedback.classList.add('hidden');
      feedback.textContent = '';
      const answers = Object.create(null);
      let firstInvalid;
      for (const control of controls.values()) {
        clearError(control);
        const { field, inputs, required } = control;
        const value = field.type === 'checkboxes'
          ? inputs.filter(input => input.checked).map(input => input.value)
          : field.type === 'radio' ? inputs.find(input => input.checked)?.value || '' : inputs[0].value.trim();
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
        else if (file && !(new Set(['image/png', 'image/jpeg', 'application/pdf']).has(file.type)
          || (!file.type && /\.(png|jpe?g|pdf)$/i.test(file.name)))) error = 'JPG, PNG veya PDF dosyası seç.';
        if (error) {
          setError(control, error);
          firstInvalid ||= receiptInput;
        }
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
      pending = true;
      submit.disabled = true;
      submit.textContent = 'Kaydın gönderiliyor…';
      form.setAttribute('aria-busy', 'true');
      // Keep the exact submitted values visible while the request is pending.
      const editable = [...form.querySelectorAll('input, textarea, select')];
      editable.forEach(input => { input.disabled = true; });
      try {
        const response = await timedFetch(endpoint('submit', event.id), { method: 'POST', body: payload });
        let result;
        try { result = await response.json(); } catch {}
        if (!response.ok || result?.ok !== true) {
          if (response.status === 409 && result?.code === 'REGISTRATION_FULL') return full(container, true);
          if (response.status === 409 || response.status === 404) {
            throw new Error(typeof result?.error === 'string' ? result.error
              : 'Bu etkinlik için artık kayıt alınmıyor. Girdiğin bilgiler gönderilemedi.');
          }
          if (response.status === 429) throw new Error('Çok sık kayıt denemesi yapıldı. Biraz bekleyip tekrar deneyebilirsin.');
          throw new Error(typeof result?.error === 'string' ? result.error : 'Kaydın gönderilemedi. Bilgilerini koruduk; tekrar deneyebilirsin.');
        }
        const success = node('div', 'registration-success');
        success.id = 'registrationSuccess';
        success.setAttribute('role', 'status');
        success.tabIndex = -1;
        success.append(node('span', 'registration-success-mark', '✓'), node('h3', '', 'Kaydın alındı!'),
          node('p', '', 'Bilgilerin organizatörlere iletildi. Etkinlikle ilgili bilgilendirmeler için duyuruları takip edebilirsin.'));
        const back = node('a', 'event-secondary-action', 'Diğer etkinlikleri keşfet');
        back.href = 'etkinlikler.html';
        success.append(back);
        container.replaceChildren(success);
        success.focus();
      } catch (error) {
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
  }

  async function mount({ event, container }) {
    const loading = node('p', 'registration-loading', 'Kayıt formu yükleniyor…');
    loading.setAttribute('role', 'status');
    container.replaceChildren(loading);
    try {
      const response = await timedFetch(endpoint('form', event.id));
      let data;
      try { data = await response.json(); } catch {}
      if ((response.ok && data?.full === true) || (response.status === 409 && data?.code === 'REGISTRATION_FULL')) return full(container);
      if (response.status === 404 || response.status === 409) return unavailable(container);
      if (!response.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Kayıt formu şu anda yüklenemedi. Tekrar deneyebilirsin.');
      if (!data) throw new Error('Kayıt formu bilgileri okunamadı. Tekrar deneyebilirsin.');
      if (!data.available || !data.form?.enabled) return unavailable(container);
      if (!validateConfig(data.form)) throw new Error('Form bilgileri geçersiz.');
      renderForm(container, data.form, event);
    } catch (error) {
      const state = node('div', 'registration-load-error');
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
      state.append(message, retry);
      container.replaceChildren(state);
    }
  }
  return { mount };
})();
