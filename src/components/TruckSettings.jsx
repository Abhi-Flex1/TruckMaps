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
    <>
      <h3 className="section-title">Profilo camion</h3>
      <form onSubmit={handleSubmit} className="truck-form">
        <label className="field-label">
          Altezza (m)
          <input
            value={formState.height}
            onChange={(event) => handleChange("height", event.target.value)}
            placeholder="4.0"
          />
        </label>
        <label className="field-label">
          Peso (t)
          <input
            value={formState.weight}
            onChange={(event) => handleChange("weight", event.target.value)}
            placeholder="18"
          />
        </label>
        <label className="field-label">
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
    </>
  );
}

export default TruckSettings;
