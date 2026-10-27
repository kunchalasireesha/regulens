// Fictional licensing applications used to generate sample PDFs. All companies,
// people, addresses, and numbers are invented.
//
// Each fixture is also the ground truth for what extraction should return, so the
// evaluation script (Phase 8) can score the model against the same data the PDF
// was rendered from.

export type SampleAddress = {
  street: string;
  unit: string | null;
  city: string;
  state: string;
  postalCode: string;
};

export type SamplePerson = {
  name: string;
  title: string;
  /** null when the document does not state an ownership percentage. */
  ownershipPercentage: number | null;
  relationship: string;
};

export type SampleApplication = {
  slug: string;
  /** What this sample is for; not rendered into the PDF. */
  purpose: string;
  business: {
    legalName: string;
    dbaNames: string[];
    formationJurisdiction: string;
    formationDate: string;
    registeredAddress: SampleAddress;
    principalAddress: SampleAddress;
  };
  licensing: {
    licenseType: string;
    /** null renders as "Not yet assigned". */
    licenseNumber: string | null;
    applicationDate: string;
    /** null renders as "Not applicable". */
    expirationDate: string | null;
  };
  people: SamplePerson[];
};

export const harborline: SampleApplication = {
  slug: "harborline-payments",
  purpose: "Complete, internally consistent application. Should validate cleanly.",
  business: {
    legalName: "Harborline Payments, Inc.",
    dbaNames: ["Harborline Pay"],
    formationJurisdiction: "DE",
    formationDate: "March 3, 2021",
    registeredAddress: {
      street: "1209 Orange Street",
      unit: null,
      city: "Wilmington",
      state: "DE",
      postalCode: "19801",
    },
    principalAddress: {
      street: "455 Market Street",
      unit: "Suite 1200",
      city: "San Francisco",
      state: "CA",
      postalCode: "94105",
    },
  },
  licensing: {
    licenseType: "Money Transmitter License",
    licenseNumber: "MTL-2026-004417",
    applicationDate: "September 14, 2026",
    expirationDate: "December 31, 2027",
  },
  people: [
    {
      name: "Dana Okafor",
      title: "Chief Executive Officer",
      ownershipPercentage: 62.5,
      relationship: "Officer, Beneficial Owner",
    },
    {
      name: "Miguel Herrera",
      title: "Chief Compliance Officer",
      ownershipPercentage: null,
      relationship: "Officer",
    },
    {
      name: "Priya Raman",
      title: "Director",
      ownershipPercentage: 25,
      relationship: "Director, Beneficial Owner",
    },
  ],
};

export const cobaltPeak: SampleApplication = {
  slug: "cobalt-peak-remit",
  purpose:
    "Deliberate problems for validation (Phase 4): ownership over 100%, invalid state " +
    "code, expiration before application date, unassigned license number, mixed date formats.",
  business: {
    legalName: "Cobalt Peak Remit LLC",
    dbaNames: [],
    formationJurisdiction: "Delaware",
    formationDate: "07/19/2019",
    registeredAddress: {
      street: "8 The Green",
      unit: "Suite B",
      city: "Dover",
      state: "DE",
      postalCode: "19901",
    },
    principalAddress: {
      street: "2100 Ross Avenue",
      unit: "Floor 9",
      city: "Dallas",
      state: "XX",
      postalCode: "75201",
    },
  },
  licensing: {
    licenseType: "Money Transmitter License",
    licenseNumber: null,
    applicationDate: "2026-08-02",
    expirationDate: "2026-06-30",
  },
  people: [
    {
      name: "Tomasz Wierzbicki",
      title: "Managing Member",
      ownershipPercentage: 150,
      relationship: "Member, Beneficial Owner",
    },
    {
      name: "Alana Kealoha",
      title: "Chief Financial Officer",
      ownershipPercentage: 20,
      relationship: "Officer, Beneficial Owner",
    },
  ],
};

export const SAMPLE_APPLICATIONS = [harborline, cobaltPeak] as const;
