// Fictional licensing applications used to generate sample PDFs. All companies,
// people, addresses, and numbers are invented.
//
// Each fixture is also the ground truth for what extraction should return, so the
// evaluation script (`pnpm eval`, see ground-truth.ts) scores the model against the
// same data the PDF was rendered from.

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

export const lumenLedger: SampleApplication = {
  slug: "lumen-ledger",
  purpose:
    "Clean application with harder values: several DBA names, a spelled-out state, " +
    "abbreviated month names, ZIP+4, an accented name, and four control persons.",
  business: {
    legalName: "Lumen Ledger Corp.",
    dbaNames: ["Lumen Pay", "LedgerSend", "Lumen Remit Services"],
    formationJurisdiction: "New York",
    formationDate: "Sept. 5, 2018",
    registeredAddress: {
      street: "80 State Street",
      unit: null,
      city: "Albany",
      state: "NY",
      postalCode: "12207",
    },
    principalAddress: {
      street: "1 Liberty Plaza",
      unit: "Floor 23",
      city: "New York",
      state: "NY",
      postalCode: "10006-1404",
    },
  },
  licensing: {
    licenseType: "Money Transmitter License",
    licenseNumber: "NY-MT-118204",
    applicationDate: "Oct. 1, 2026",
    expirationDate: "Sept. 30, 2028",
  },
  people: [
    {
      name: "Esther Lindqvist",
      title: "President",
      ownershipPercentage: 40,
      relationship: "Officer, Director, Beneficial Owner",
    },
    {
      name: "Rafael Domínguez-Ortiz",
      title: "Chief Operating Officer",
      ownershipPercentage: 35,
      relationship: "Officer, Beneficial Owner",
    },
    {
      name: "June Nakamura",
      title: "Chief Compliance Officer",
      ownershipPercentage: null,
      relationship: "Officer",
    },
    {
      name: "Oluwaseun Adeyemi",
      title: "Independent Director",
      ownershipPercentage: 12.5,
      relationship: "Director, Beneficial Owner",
    },
  ],
};

export const prairieWire: SampleApplication = {
  slug: "prairie-wire",
  purpose:
    "Problems different from Cobalt Peak's, mostly warnings: registered office outside the " +
    "state of formation, an impossible date, a short ZIP code, an owner with no stated " +
    "percentage, ownership totalling 105%, and five control persons.",
  business: {
    legalName: "Prairie Wire Transfer Co.",
    dbaNames: ["Prairie Wire"],
    formationJurisdiction: "Kansas",
    formationDate: "02/30/2020",
    registeredAddress: {
      street: "120 Walnut Street",
      unit: null,
      city: "Kansas City",
      state: "MO",
      postalCode: "64106",
    },
    principalAddress: {
      street: "9300 Metcalf Avenue",
      unit: "Suite 410",
      city: "Overland Park",
      state: "KS",
      postalCode: "6621",
    },
  },
  licensing: {
    licenseType: "Money Transmitter License",
    licenseNumber: "KS-MTL-0091",
    applicationDate: "June 22, 2026",
    expirationDate: null,
  },
  people: [
    {
      name: "Harold Brandt",
      title: "Chief Executive Officer",
      ownershipPercentage: 55,
      relationship: "Officer, Beneficial Owner",
    },
    {
      name: "Corinne Vasquez",
      title: "President",
      ownershipPercentage: 50,
      relationship: "Officer, Director, Beneficial Owner",
    },
    {
      name: "Samuel Whitfield",
      title: "Treasurer",
      ownershipPercentage: null,
      relationship: "Officer, Beneficial Owner",
    },
    {
      name: "Grace Liu",
      title: "Chief Compliance Officer",
      ownershipPercentage: null,
      relationship: "Officer",
    },
    {
      name: "Daniel Okoro",
      title: "Director",
      ownershipPercentage: null,
      relationship: "Director",
    },
  ],
};

export const SAMPLE_APPLICATIONS = [harborline, cobaltPeak, lumenLedger, prairieWire] as const;
