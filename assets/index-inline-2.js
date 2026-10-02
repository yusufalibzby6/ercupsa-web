document.addEventListener('DOMContentLoaded', () => {
            if (!localStorage.getItem('ercupsa-welcome-seen')) {
                const modal = document.getElementById('welcomeModal');
                modal.classList.remove('hidden');
                modal.classList.add('flex');
                const dismiss = () => {
                    modal.classList.add('hidden');
                    modal.classList.remove('flex');
                    localStorage.setItem('ercupsa-welcome-seen', '1');
                };
                document.getElementById('closeWelcome').addEventListener('click', dismiss);
                document.getElementById('continueSite').addEventListener('click', dismiss);
                modal.addEventListener('click', (e) => { if (e.target === modal) dismiss(); });
                document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dismiss(); });
            }
        });
