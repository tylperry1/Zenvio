"use client";
import { useState } from "react";
import { Documents } from "./documents";
import { Envelopes } from "./envelopes";
export function DocumentCenter() {
  const [legacy, setLegacy] = useState(false);
  return legacy ? (
    <>
      <div className="legacy-document-nav">
        <button onClick={() => setLegacy(false)}>← PDF envelopes</button>
      </div>
      <Documents />
    </>
  ) : (
    <Envelopes onLegacy={() => setLegacy(true)} />
  );
}
