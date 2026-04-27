import { useRef } from "react";

// File picker for CSVs. Reads the file as text and hands the raw string back
// via onParsed; parsing happens in the page so the page can keep the
// pre-parse text around for re-runs after pipeline edits.
export default function CsvUploader({ onLoaded, onError, label = "Upload CSV" }) {
  const inputRef = useRef(null);

  const handleChange = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-uploading the same file
    if (!file) return;
    try {
      const text = await file.text();
      onLoaded({ filename: file.name, text });
    } catch (err) {
      onError(err.message ?? String(err));
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        style={{ display: "none" }}
        onChange={handleChange}
      />
      <button
        onClick={() => inputRef.current?.click()}
        style={{ fontSize: 13 }}
      >
        {label} &#8593;
      </button>
    </>
  );
}
