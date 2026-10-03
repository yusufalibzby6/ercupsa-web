document.getElementById('contactForm').addEventListener('submit', function (e) {
            e.preventDefault();
            const form = e.target;
            const submitBtn = document.getElementById('submitBtn');
            document.getElementById('errorMsg').classList.add('hidden');
            submitBtn.disabled = true;
            submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Gönderiliyor...';

            const data = new FormData(form);
            fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams(data).toString()
            })
                .then((response) => {
                    if (!response.ok) throw new Error('Mesaj gönderilemedi.');
                    form.classList.add('hidden');
                    document.getElementById('successMsg').classList.remove('hidden');
                    ercupsaConfetti(document.getElementById('successMsg'));
                })
                .catch(() => {
                    document.getElementById('errorMsg').classList.remove('hidden');
                    submitBtn.disabled = false;
                    submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Gönder';
                });
        });
