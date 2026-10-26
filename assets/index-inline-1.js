try { if (localStorage.getItem('ercupsa-theme') === 'dark') document.documentElement.classList.add('dark'); } catch { /* Use the default theme when browser storage is unavailable. */ }
