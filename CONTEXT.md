# Loan Form Filling

Language for transferring information from source documents into a loan deal's forms.

## Language

**Loan deal**:
The loan transaction whose information is being entered and reviewed.
_Avoid_: Run, document

**Deal ID**:
The identifier used to select a particular loan deal.

**Source document**:
A document containing information to extract for a loan deal's forms.

**Extraction**:
The information identified in a source document for use in the form-filling workflow.

**Fill plan**:
The proposed assignments and interactions for entering extracted information into a particular form step.
_Avoid_: Extraction

**Form drift**:
A change to a form's structure or behavior that can invalidate previously observed field associations or interactions.


**Needs review**:
+A field status indicating that automatic filling could not confidently identify, complete, or verify the intended entry and the user must check it manually.

**Draft entry**:
+A value entered in the loan form that has not yet been persisted by the user's save action.
