import React from 'react';

export function FailureAttributionLabel({ label }: { label: string | null }) {
  return label ? <div className="mt-1 typography-meta text-muted-foreground break-words" data-failure-attribution>{label}</div> : null;
}
