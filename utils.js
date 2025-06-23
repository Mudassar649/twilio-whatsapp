export function normalizePhoneNumber(phone) {
    const cleaned = phone.replace('whatsapp:', '').replace(/\D/g, '');
    return cleaned.replace(/^1/, '');
}

export function formatWhatsAppNumber(phone) {
    const normalized = normalizePhoneNumber(phone);
    return `whatsapp:+${normalized}`;
}

export function parseResponse(response, expectedFormat) {
    const cleaned = response.trim().toUpperCase();
    
    if (expectedFormat === 'YN') {
        return cleaned === 'Y' || cleaned === 'YES' ? 'Y' : 'N';
    }
    
    if (expectedFormat === 'COMMA_SEPARATED') {
        return cleaned.split(',').map(item => item.trim());
    }
    
    return cleaned;
}