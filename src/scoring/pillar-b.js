// Pillar B — Contact & identity (10 points).
//
// "Can a recruiter reach the person, and is the top block clean?" The cheapest
// possible rejection is a CV nobody can reply to, which is why B01 and B02 are
// critical despite being worth two points each.

import { findPlace, looksLikeStreetAddress, findPersonalDetails } from '../lexicons/places.js';

// The identity block: the top fifth of page one, where a name belongs.
const IDENTITY_BAND = 0.2;

export const PILLAR_B = [
  {
    id: 'B01',
    points: 2,
    severity: 'critical',
    title: 'No name found',
    run(ctx) {
      if (ctx.entities.contact.name) return null;
      const firstPage = ctx.document.pages[0];
      const limit = firstPage ? firstPage.height * IDENTITY_BAND : 168;
      const top = ctx.allLines.filter((line) => line.page === 1 && line.top < limit);
      return {
        message: 'Put your full name on the first line, on its own, in plain text.',
        evidence: [{
          page: 1,
          text: top.length ? `the top of page 1 reads: ${top[0].text}` : 'the top of page 1 is empty',
        }],
      };
    },
  },

  {
    id: 'B02',
    points: 2,
    severity: 'critical',
    title: 'No email address',
    run(ctx) {
      if (ctx.entities.contact.email) return null;
      return {
        message: 'Add a plain-text email address in the top block. Without one, a recruiter who wants you cannot reply.',
        evidence: [{ page: 1, text: 'no email address anywhere in the document' }],
      };
    },
  },

  {
    id: 'B03',
    points: 2,
    severity: 'major',
    title: 'No phone number, or no country code',
    run(ctx) {
      const phone = ctx.entities.contact.phone;
      if (phone && phone.international) return null;
      if (!phone) {
        return {
          message: 'Add a phone number with its country code, for example +64 21 555 0134.',
          evidence: [{ page: 1, text: 'no phone number found' }],
        };
      }
      return {
        message: 'Add the country code to your phone number (+64 21 …). Recruiters hiring across borders cannot dial a local-format number.',
        evidence: [{ page: 1, text: phone.text }],
      };
    },
  },

  {
    id: 'B04',
    points: 1,
    severity: 'minor',
    title: 'Location missing, or too much of it',
    run(ctx) {
      // The identity block is where a location belongs; a country named deep
      // in an employment history is an employer's address, not the reader's.
      const top = ctx.sections.preamble.map((line) => line.text).join(' ');
      const street = looksLikeStreetAddress(top);
      if (street) {
        return {
          message: 'Give city and country only. A full street address is unnecessary, and publishing your home address on a document you send to strangers is a privacy risk.',
          evidence: [{ page: 1, text: top.slice(0, 100) }],
        };
      }
      if (findPlace(top)) return null;
      return {
        message: 'Add your city and country to the top block. Recruiters filter by location before they read anything else.',
        evidence: [{ page: 1, text: 'no city or country in the top block' }],
      };
    },
  },

  {
    id: 'B05',
    points: 1,
    severity: 'minor',
    title: 'No LinkedIn or portfolio link',
    run(ctx) {
      if (ctx.entities.contact.link) return null;
      return {
        message: 'Add your LinkedIn URL as visible text. It is the first thing most recruiters check after the phone number.',
        evidence: [{ page: 1, text: 'no profile or portfolio URL in the text' }],
      };
    },
  },

  {
    id: 'B06',
    points: 1,
    severity: 'critical',
    title: 'Contact details only in the header',
    run(ctx) {
      const inBand = /@|\+\d{1,3}[\s\d]|linkedin/i.test(ctx.bandText);
      if (!inBand) return null;
      // Only a problem when the body has nothing: details in both places are
      // belt and braces, not a defect.
      const inBody = /@|\+\d{1,3}[\s\d]|linkedin/i.test(ctx.bodyText);
      if (inBody) return null;
      return {
        message: 'Your contact details are in the page header, where many parsers never look. Move them into the body of the first page.',
        evidence: [{ page: 1, text: ctx.bandText.slice(0, 100) }],
      };
    },
  },

  {
    id: 'B07',
    points: 0.5,
    severity: 'minor',
    title: 'A photo',
    run(ctx) {
      const firstPage = ctx.document.pages[0];
      if (!firstPage) return null;
      const photo = firstPage.images.find((image) => {
        const aspect = image.height ? image.width / image.height : 0;
        return image.areaRatio >= 0.02
          && aspect >= 0.5 && aspect <= 1.5
          && image.top < firstPage.height / 3;
      });
      if (!photo) return null;
      return {
        message: 'Most English-speaking markets ask for no photo — it adds parse noise and bias risk. Remove it unless the market you are applying to expects one.',
        evidence: [{
          page: 1,
          text: `an image covering ${Math.round(photo.areaRatio * 100)}% of the first page`,
          box: { x: photo.x, top: photo.top, width: photo.width, height: photo.height },
        }],
      };
    },
  },

  {
    id: 'B08',
    points: 0.5,
    severity: 'major',
    title: 'Personal details that invite bias',
    run(ctx) {
      const found = findPersonalDetails(ctx.allText);
      if (!found.length) return null;
      return {
        message: 'Remove date of birth and personal status details. They are not needed for the decision and they invite bias — in several markets a recruiter is not allowed to consider them at all.',
        evidence: [{ page: 1, text: `found: ${found.join(', ')}` }],
      };
    },
  },
];
