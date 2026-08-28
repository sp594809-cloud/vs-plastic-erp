// Indian Number to Words Converter

function convertNumberToWords(amount) {
    const value = Math.floor(amount);
    if (value === 0) return 'Zero Rupees';

    const singleDigits = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
    const doubleDigits = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const tensDigits = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

    function convertGroup(n) {
        let str = '';
        if (n >= 100) {
            str += singleDigits[Math.floor(n / 100)] + ' Hundred ';
            n %= 100;
        }
        if (n >= 10 && n < 20) {
            str += doubleDigits[n - 10] + ' ';
        } else if (n >= 20) {
            str += tensDigits[Math.floor(n / 10)] + ' ' + singleDigits[n % 10] + ' ';
        } else if (n > 0) {
            str += singleDigits[n] + ' ';
        }
        return str;
    }

    let result = '';
    let temp = value;

    // Crores
    if (temp >= 10000000) {
        result += convertGroup(Math.floor(temp / 10000000)) + ' Crore ';
        temp %= 10000000;
    }

    // Lakhs
    if (temp >= 100000) {
        result += convertGroup(Math.floor(temp / 100000)) + ' Lakh ';
        temp %= 100000;
    }

    // Thousands
    if (temp >= 1000) {
        result += convertGroup(Math.floor(temp / 1000)) + ' Thousand ';
        temp %= 1000;
    }

    // Hundreds & Tens
    result += ' ' + convertGroup(temp);

    // Paisa (cents)
    const paisa = Math.round((amount - value) * 100);
    let paisaStr = '';
    if (paisa > 0) {
        paisaStr = ' and ' + convertGroup(paisa) + ' Paisa';
    }

    // Combine and replace multiple spaces with single space
    const combined = result.trim() + ' Rupees' + paisaStr;
    return combined.replace(/\s+/g, ' ').trim();
}

module.exports = convertNumberToWords;
