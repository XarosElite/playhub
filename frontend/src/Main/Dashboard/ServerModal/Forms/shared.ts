import { hasLength } from "@mantine/form";


/**
 * All forms should use this implementation
 */
export interface ServerFormProps<T> {
    onClose: () => void;
    onSubmit: (data: T) => void;
    submitting: boolean;
}

/**
 * Validates a server name in the form creation.
 * @param value the value to validate
 * @returns 
 */
export function validateServerName(value: string) {
    // Length validation: between 3 and 36 characters
    if (hasLength({ min: 3, max: 36 })(value)) {
        return 'Must be between 3 and 36 characters';
    }
    
    // Regex to check if it starts or ends with prohibited symbols
    const startsOrEndsWithSymbol = /^[._-]|[._-]$/;
    if (startsOrEndsWithSymbol.test(value)) {
        return 'Cannot start or end with ".", "_", or "-"';
    }

    // Regex to check for sequential symbols
    const sequentialSymbols = /[._-]{2,}/;
    if (sequentialSymbols.test(value)) {
        return 'Cannot contain sequential symbols like "..", "__", or "--"';
    }

    // Regex to ensure only allowed characters are used
    const validFormat = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/;
    if (!validFormat.test(value)) {
        return 'Can only contain letters, numbers, ".", "_", or "-"';
    }

    return null; // No errors
}
