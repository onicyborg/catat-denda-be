// Only the isolated QA runner imports this helper; it never writes to the application's database.
export function fixtureDraft(incident) {
  return {
    occurredAt: null,
    violationTypeId: null,
    sourceText: incident.source_text,
    description: incident.raw_description,
    members: incident.proposed_allocations.map((allocation) => ({
      employeeId: null,
      rawEmployeeName: allocation.raw_employee_name,
      assignedAmount: allocation.proposed_amount_idr,
    })),
  };
}
