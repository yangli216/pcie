import { ref } from 'vue';
import { describe, expect, it } from 'vitest';
import { useFemaleHistoryFields } from './useFemaleHistoryFields';

describe('female history editor fields', () => {
  it('applies same-stream fields independently without overwriting manual edits', () => {
    const fields = useFemaleHistoryFields(ref(true));
    fields.restore({ menstrualHistory: '周期28天', maritalReproductiveHistory: '已婚已育' });
    fields.captureBaseline();
    fields.menstrualHistory.value = '医生修订：周期30天';
    fields.applyProgressive({ menstrualHistory: '周期29天', maritalReproductiveHistory: '已婚已育；未孕' });
    expect(fields.menstrualHistory.value).toBe('医生修订：周期30天');
    expect(fields.maritalReproductiveHistory.value).toBe('已婚已育；未孕');
  });

  it('clears absent cache fields and both histories for a male patient', () => {
    const female = ref(true);
    const fields = useFemaleHistoryFields(female);
    fields.restore({ menstrualHistory: '周期28天', maritalReproductiveHistory: '已婚已育' });
    fields.restore({ menstrualHistory: '周期30天' });
    expect(fields.maritalReproductiveHistory.value).toBe('');
    female.value = false;
    fields.captureBaseline();
    fields.applyProgressive({ menstrualHistory: '迟到月经史', maritalReproductiveHistory: '迟到婚育史' });
    expect(fields.menstrualHistory.value).toBe('');
    expect(fields.maritalReproductiveHistory.value).toBe('');
  });
});
