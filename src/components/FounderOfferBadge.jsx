// FounderOfferBadge
// "Motorista Fundador" badge. Render only when driver.isFounder is true.
// Label text is fixed by product — comes from founderOfferRules.

import AppBadge from './AppBadge';
import { FOUNDER_LABEL_PT_BR } from '../constants/founderOfferRules';

export default function FounderOfferBadge() {
  return <AppBadge label={FOUNDER_LABEL_PT_BR} tone="success" />;
}
