function openInBlank() {
    const win = window.open('about:blank', '_blank');
    win.document.write(`
        <iframe style="width: 100%; height: 100%; border: none;" 
                src="${window.location.href}"></iframe>
    `);
    win.document.body.style.margin = '0';
}