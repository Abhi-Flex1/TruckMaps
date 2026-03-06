import { MARKER_TYPES } from "../services/storage";

function MarkerModal({ isOpen, onClose, onSave }) {
  if (!isOpen) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const type = formData.get("type");
    const note = formData.get("note")?.toString().trim() || "";
    onSave({ type, note });
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card">
        <h3>Aggiungi segnalazione</h3>
        <form onSubmit={handleSubmit}>
          <label>
            Tipo
            <select name="type" defaultValue="avoid">
              {Object.entries(MARKER_TYPES).map(([type, info]) => (
                <option key={type} value={type}>
                  {info.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nota (opzionale)
            <textarea name="note" rows="2" placeholder="Dettagli strada..." />
          </label>
          <div className="row-actions">
            <button type="button" className="pressable secondary-btn" onClick={onClose}>
              Annulla
            </button>
            <button type="submit" className="pressable primary-btn">
              Salva
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default MarkerModal;
