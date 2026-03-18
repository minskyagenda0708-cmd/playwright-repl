export async function saveToFile(dataUrl: string | undefined) {
    if (!dataUrl) return;
    const isPdf = dataUrl.startsWith('data:application/pdf');
    const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, "-");
    try {
        const handle = await window.showSaveFilePicker({
            suggestedName: isPdf ? `page-${timestamp}.pdf` : `screenshot-${timestamp}.png`,
            types: isPdf
                ? [{ description: "PDF documents", accept: { "application/pdf": [".pdf"] } }]
                : [{ description: "PNG images", accept: { "image/png": [".png"] } }],
        });
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
    } catch (e: unknown) {
        if (e instanceof Error && e.name !== "AbortError") console.error("Save failed:", e);
    }
}