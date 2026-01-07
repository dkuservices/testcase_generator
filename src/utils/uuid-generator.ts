import { v4 as uuidv4 } from 'uuid';

export function generateUUID(): string {
  return uuidv4();
}

export function generateJobId(): string {
  return `job-${uuidv4()}`;
}

export function generateTestId(): string {
  return `test-${uuidv4()}`;
}
