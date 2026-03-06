import { useEffect, useState } from "react";

function TruckSettings({ initialValues, onSave }) {
  const [formState, setFormState] = useState(initialValues);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setFormState(initialValues);
  }, [initialValues]);

  const handleChange = (field, value) => {
    setFormState((current) => ({ ...current, [field]: value }));
    setSaved(false);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    onSave(formState);
    setSaved(true);
  };

  return (
    <div className="sheet-card">
      <h3>Impostazioni Camion</h3>
      <form onSubmit={handleSubmit}>
        <label>
          Altezza (m)
          <input
            value={formState.height}
            onChange={(event) => handleChange("height", event.target.value)}
            placeholder="4.0"
          />
        </label>
        <label>
          Peso (t)
          <input
            value={formState.weight}
            onChange={(event) => handleChange("weight", event.target.value)}
            placeholder="18"
          />
        </label>
        <label>
          Lunghezza (m)
          <input
            value={formState.length}
            onChange={(event) => handleChange("length", event.target.value)}
            placeholder="12"
          />
        </label>
        <button type="submit" className="pressable primary-btn">
          Salva impostazioni
        </button>
      </form>
      {saved ? <p className="small-text success-text">Salvato in locale.</p> : null}
    </div>
  );
}

export default TruckSettings;
