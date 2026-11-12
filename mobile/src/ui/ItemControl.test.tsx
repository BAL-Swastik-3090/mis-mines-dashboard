/**
 * The one component with rules in it, rendered.
 *
 * Everything else on the capture screens is layout. This is where an answer
 * becomes a finding, where the remark box and the camera appear, and where a
 * critical item refuses to offer N/A — so this is the part worth rendering
 * rather than reasoning about.
 */

import { render, fireEvent, screen } from '@testing-library/react-native';
import { ItemControl } from './ItemControl';
import type { ChecklistItem, RawResponse } from '@/core/evaluation';

const brakes: ChecklistItem = {
  itemId: 101, label: 'Service brake response', responseType: 'OK_CAUTION_NOTOK',
  isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
};
const lights: ChecklistItem = {
  itemId: 104, label: 'Lights', responseType: 'OK_CAUTION_NOTOK',
  isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'LOW',
};
const air: ChecklistItem = {
  itemId: 103, label: 'Air pressure', responseType: 'NUMERIC',
  isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
  unit: 'psi', minValue: 80, maxValue: 120,
};
const boom: ChecklistItem = {
  itemId: 105, label: 'Boom pressure', responseType: 'NUMERIC',
  isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'HIGH',
  unit: 'bar', minValue: null, maxValue: null,
};

const setup = (item: ChecklistItem, value?: RawResponse, photoCount = 0) => {
  const onChange = jest.fn();
  const onAddPhoto = jest.fn();
  render(<ItemControl item={item} value={value} photoCount={photoCount}
                      onChange={onChange} onAddPhoto={onAddPhoto} />);
  return { onChange, onAddPhoto };
};

describe('a critical item', () => {
  it('says so before it is answered, not after', () => {
    setup(brakes);
    expect(screen.getByText('STOPS THE MACHINE')).toBeTruthy();
  });

  it('does not offer N/A at all, rather than offering it and refusing it later', () => {
    setup(brakes);
    expect(screen.queryByTestId('answer-101-NA')).toBeNull();
    expect(screen.getByTestId('answer-101-OK')).toBeTruthy();
    expect(screen.getByTestId('answer-101-NOT_OK')).toBeTruthy();
  });
});

describe('an ordinary item', () => {
  it('does offer N/A', () => {
    setup(lights);
    expect(screen.getByTestId('answer-104-NA')).toBeTruthy();
  });

  it('is not marked as stopping the machine', () => {
    setup(lights);
    expect(screen.queryByText('STOPS THE MACHINE')).toBeNull();
  });
});

describe('answering', () => {
  it('reports the answer back, clearing any reading', () => {
    const { onChange } = setup(brakes);
    fireEvent.press(screen.getByTestId('answer-101-OK'));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 101, answer: 'OK', numericValue: null }));
  });

  it('shows no remark box while the answer is OK', () => {
    setup(brakes, { itemId: 101, answer: 'OK' });
    expect(screen.queryByTestId('remark-101')).toBeNull();
    expect(screen.queryByTestId('photo-101')).toBeNull();
  });

  it('opens the remark box and the camera the moment NOT OK is given', () => {
    setup(brakes, { itemId: 101, answer: 'NOT_OK' });
    expect(screen.getByTestId('remark-101')).toBeTruthy();
    expect(screen.getByTestId('photo-101')).toBeTruthy();
  });

  it('does the same on CAUTION — a machine that runs but needs watching is the point', () => {
    setup(brakes, { itemId: 101, answer: 'CAUTION' });
    expect(screen.getByTestId('remark-101')).toBeTruthy();
  });

  it('says what is still missing on an adverse answer', () => {
    setup(brakes, { itemId: 101, answer: 'NOT_OK' });
    expect(screen.getByText('Say what is wrong')).toBeTruthy();
    // The photo is asked for by the button, not also in the problem list. The
    // first version printed both, which reads as two things to do.
    expect(screen.getByTestId('photo-101')).toBeTruthy();
    expect(screen.getAllByText('Add a photo')).toHaveLength(1);
  });

  it('still lists the missing photo where there is no button to ask for it', () => {
    // An adverse answer on an item that requires a photo but whose button is
    // not shown would leave nothing saying so. Guarding the opposite case.
    setup({ ...lights, requiresPhotoIfNotOk: true },
          { itemId: 104, answer: 'NOT_OK', remark: 'nearside out' }, 0);
    expect(screen.getByTestId('photo-104')).toBeTruthy();
  });

  it('stops asking once the remark and the photo are there', () => {
    setup(brakes, { itemId: 101, answer: 'NOT_OK', remark: 'pedal to the floor' }, 1);
    expect(screen.queryByTestId('problems-101')).toBeNull();
    expect(screen.getByText('1 photo')).toBeTruthy();
  });

  it('does not ask for a photo on an item that does not require one', () => {
    setup(lights, { itemId: 104, answer: 'NOT_OK', remark: 'nearside out' });
    expect(screen.queryByTestId('photo-104')).toBeNull();
    expect(screen.queryByTestId('problems-104')).toBeNull();
  });
});

describe('a gauge', () => {
  it('shows the range it should be in', () => {
    setup(air);
    expect(screen.getByText('Should be 80–120 psi')).toBeTruthy();
  });

  it('says it is outside the range, and opens the consequences', () => {
    setup(air, { itemId: 103, numericValue: 60 });
    expect(screen.getByText('Outside 80–120 psi')).toBeTruthy();
    expect(screen.getByTestId('remark-103')).toBeTruthy();
  });

  it('accepts a reading inside the range quietly', () => {
    setup(air, { itemId: 103, numericValue: 100 });
    expect(screen.queryByTestId('remark-103')).toBeNull();
  });

  it('is explicit that an unbounded gauge is recorded and not judged', () => {
    setup(boom, { itemId: 105, numericValue: 9999 });
    expect(screen.getByText('Recorded, no limit set')).toBeTruthy();
    expect(screen.queryByTestId('remark-105')).toBeNull();
  });

  it('reports a typed reading as a number', () => {
    const { onChange } = setup(air);
    fireEvent.changeText(screen.getByTestId('reading-103'), '95');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 103, numericValue: 95 }));
  });

  it('reports a cleared reading as null rather than NaN', () => {
    const { onChange } = setup(air, { itemId: 103, numericValue: 95 });
    fireEvent.changeText(screen.getByTestId('reading-103'), '');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: 103, numericValue: null }));
  });

  it('reports half-typed rubbish as null rather than NaN', () => {
    const { onChange } = setup(air);
    fireEvent.changeText(screen.getByTestId('reading-103'), '9-');
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ numericValue: null }));
  });
});

describe('the photo button', () => {
  it('asks for the camera when pressed', () => {
    const { onAddPhoto } = setup(brakes, { itemId: 101, answer: 'NOT_OK', remark: 'spongy' });
    fireEvent.press(screen.getByTestId('photo-101'));
    expect(onAddPhoto).toHaveBeenCalled();
  });
});

/* ── losing a finding to one tap ───────────────────────────────────────────
   The whole point of a walk-round is the thing somebody found. A stray tap on
   OK used to clear the finding, the remark and the photo count without a word,
   and the record then showed a clean machine. */

test('changing a finding back to OK asks first when something would be lost', () => {
  const item: ChecklistItem = {
    itemId: 1, label: 'Service brake response', responseType: 'OK_CAUTION_NOTOK',
    isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
  };
  const onChange = jest.fn();
  const { getByTestId, queryByTestId } = render(
    <ItemControl
      item={item}
      value={{ itemId: 1, answer: 'NOT_OK', remark: 'pedal to the floor' }}
      photoCount={1}
      onChange={onChange}
      onAddPhoto={() => {}}
    />,
  );

  fireEvent.press(getByTestId('answer-1-OK'));

  // Nothing changed yet — it asked.
  expect(onChange).not.toHaveBeenCalled();
  expect(queryByTestId('confirm-clear-1')).not.toBeNull();

  fireEvent.press(getByTestId('confirm-clear-no-1'));
  expect(onChange).not.toHaveBeenCalled();
});

test('confirming the removal does change the answer, and keeps what was written', () => {
  const item: ChecklistItem = {
    itemId: 1, label: 'Service brake response', responseType: 'OK_CAUTION_NOTOK',
    isCritical: true, requiresPhotoIfNotOk: true, defaultSeverity: 'CRITICAL',
  };
  const onChange = jest.fn();
  const { getByTestId } = render(
    <ItemControl
      item={item}
      value={{ itemId: 1, answer: 'NOT_OK', remark: 'pedal to the floor' }}
      photoCount={1}
      onChange={onChange}
      onAddPhoto={() => {}}
    />,
  );

  fireEvent.press(getByTestId('answer-1-OK'));
  fireEvent.press(getByTestId('confirm-clear-yes-1'));

  expect(onChange).toHaveBeenCalledTimes(1);
  const sent = onChange.mock.calls[0]![0];
  expect(sent.answer).toBe('OK');
  // Deleting what somebody wrote because of a tap is the same mistake again.
  expect(sent.remark).toBe('pedal to the floor');
});

test('a finding with nothing attached changes without being questioned', () => {
  const item: ChecklistItem = {
    itemId: 2, label: 'Mirror', responseType: 'OK_CAUTION_NOTOK',
    isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'LOW',
  };
  const onChange = jest.fn();
  const { getByTestId, queryByTestId } = render(
    <ItemControl item={item} value={{ itemId: 2, answer: 'NOT_OK' }}
                 photoCount={0} onChange={onChange} onAddPhoto={() => {}} />,
  );

  fireEvent.press(getByTestId('answer-2-OK'));
  expect(queryByTestId('confirm-clear-2')).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(1);
});

test('marking something NOT OK is never questioned', () => {
  const item: ChecklistItem = {
    itemId: 3, label: 'Tyres', responseType: 'OK_CAUTION_NOTOK',
    isCritical: false, requiresPhotoIfNotOk: false, defaultSeverity: 'MEDIUM',
  };
  const onChange = jest.fn();
  const { getByTestId, queryByTestId } = render(
    <ItemControl item={item} value={{ itemId: 3, answer: 'OK' }}
                 photoCount={0} onChange={onChange} onAddPhoto={() => {}} />,
  );

  fireEvent.press(getByTestId('answer-3-NOT_OK'));
  expect(queryByTestId('confirm-clear-3')).toBeNull();
  expect(onChange).toHaveBeenCalledTimes(1);
});
