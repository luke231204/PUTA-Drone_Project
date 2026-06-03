import re
from unittest.mock import MagicMock
import sys

# Mock pypdf before importing sync-pdf
class MockPage:
    def __init__(self, text):
        self.text = text
    def extract_text(self):
        return self.text

class MockPdfReader:
    def __init__(self, filepath):
        self.pages = [MockPage(test_text)]

sys.modules['pypdf'] = MagicMock()
import pypdf
pypdf.PdfReader = MockPdfReader

# Import the module with hyphen
sync_pdf = __import__('sync-pdf')

test_text = """
KEMENTERIAN PERHUBUNGAN
DIREKTORAT JENDERAL PERHUBUNGAN UDARA

Nomor      : 0006/APPROVAL-PUTA/DNP-2026                 Jakarta, 16 Januari 2026
Klasifikasi: Biasa
Lampiran   : 1 (satu) berkas
Hal        : Persetujuan Pengoperasian Pesawat Udara Tanpa Awak
             PT TORTUGA XCEL DYNAMICS

Yth. Direktur Utama PT TORTUGA XCEL DYNAMICS

Menindaklanjuti Permohonan Penerbitan Persetujuan Pengoperasian Pesawat Udara Tanpa Awak (PUTA) oleh PT TORTUGA XCEL DYNAMICS nomor : 1159/OPS-PUTA.DNP/2025 tanggal 30 Desember 2025, dengan ini disampaikan bahwa sesuai PM 37 tahun 2020 tentang Pengoperasian Pesawat Udara Tanpa Awak Di Ruang Udara Yang Dilayani Indonesia diberikan persetujuan pengoperasian pesawat udara tanpa awak kepada PT TORTUGA XCEL DYNAMICS dalam rangka Pemotretan / Foto Udara Pemetaan Foto Udara yang berlokasi di Ogan Komering Ilir pada tanggal 16 Januari 2026 s.d. 16 Januari 2026.

1. Mengoperasikan pesawat udara tanpa awak sesuai dengan Permenhub PM 63 Tahun 2021 / CASR Part 107;
2. Ketinggian maksimum pengoperasian adalah 400 kaki (120 meter) AGL;
3. Koordinat area kerja yang disetujui adalah sebagai berikut:
   Titik A: 03°15'30" LS - 104°30'00" BT
   Titik B: 03°16'00" LS - 104°31'00" BT
   Titik C: 03°15'00" LS - 104°32'00" BT
"""

def test_extraction():
    print("Testing parse_pdf_permit directly with Mocked PDF...")
    
    # Run the actual function in sync-pdf.py
    permit_data = sync_pdf.parse_pdf_permit("dummy_path.pdf", 2026)
    
    print("\nParsed Data:")
    for k, v in permit_data.items():
        print(f"  {k}: {v}")
        
    assert permit_data["permit_id"] == "0006/APPROVAL-PUTA/DNP-2026"
    assert permit_data["operator_name"] == "PT TORTUGA XCEL DYNAMICS"
    assert permit_data["location"] == "Ogan Komering Ilir"
    assert permit_data["year"] == 2026
    assert permit_data["date_start"] == "2026-01-16"
    assert permit_data["date_end"] == "2026-01-16"
    assert permit_data["max_altitude_ft"] == 400
    assert len(permit_data["coordinates"]) == 3
    
    # Check coordinate values
    first_coord = permit_data["coordinates"][0]
    assert abs(first_coord[0] - (-3.258333)) < 0.0001
    assert abs(first_coord[1] - 104.5000) < 0.0001
    
    print("\nALL PARSER TESTS PASSED SUCCESSFULLY!")

if __name__ == '__main__':
    test_extraction()
