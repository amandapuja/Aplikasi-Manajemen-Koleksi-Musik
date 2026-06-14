package main

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
)

func init() {
	if runtime.GOOS == "windows" {
		cmd := exec.Command("cmd", "/c", "chcp", "65001")
		cmd.Stdout = os.Stdout
		cmd.Run()
	}
}

func bacaLine() string {
	var hasil string
	var c rune
	for {
		n, _ := fmt.Scanf("%c", &c)
		if n == 0 {
			break
		}
		if c == '\n' || c == '\r' {
			if c == '\r' {
				fmt.Scanf("%c", &c)
			}
			break
		}
		hasil += string(c)
	}
	return hasil
}


type Lagu struct {
	ID     int
	Judul  string
	Artis  string
	Genre  string
	Rating float64
}

type KoleksiMusik struct {
	DaftarLagu []Lagu
	IDTerakhir int
}

var koleksi KoleksiMusik

func trimSpasi(s string) string {
	start := 0
	end := len(s)
	for start < end && (s[start] == ' ' || s[start] == '\t' || s[start] == '\n' || s[start] == '\r') {
		start++
	}
	for end > start && (s[end-1] == ' ' || s[end-1] == '\t' || s[end-1] == '\n' || s[end-1] == '\r') {
		end--
	}
	return s[start:end]
}

func toLower(s string) string {
	hasil := make([]byte, len(s))
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c >= 'A' && c <= 'Z' {
			hasil[i] = c + 32
		} else {
			hasil[i] = c
		}
	}
	return string(hasil)
}

func mengandung(s, sub string) bool {
	if len(sub) == 0 {
		return true
	}
	if len(sub) > len(s) {
		return false
	}
	for i := 0; i <= len(s)-len(sub); i++ {
		cocok := true
		for j := 0; j < len(sub); j++ {
			if s[i+j] != sub[j] {
				cocok = false
				break
			}
		}
		if cocok {
			return true
		}
	}
	return false
}

func stringKeInt(s string) (int, bool) {
	s = trimSpasi(s)
	if len(s) == 0 {
		return 0, false
	}
	negatif := false
	start := 0
	if s[0] == '-' {
		negatif = true
		start = 1
	}
	hasil := 0
	for i := start; i < len(s); i++ {
		if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
		hasil = hasil*10 + int(s[i]-'0')
	}
	if negatif {
		return -hasil, true
	}
	return hasil, true
}

func stringKeFloat(s string) (float64, bool) {
	s = trimSpasi(s)
	if len(s) == 0 {
		return 0, false
	}
	titikPos := -1
	for i := 0; i < len(s); i++ {
		if s[i] == '.' {
			if titikPos != -1 {
				return 0, false
			}
			titikPos = i
		} else if s[i] < '0' || s[i] > '9' {
			return 0, false
		}
	}

	if titikPos == -1 {
		n, ok := stringKeInt(s)
		if !ok {
			return 0, false
		}
		return float64(n), true
	}

	var bulat, desimal int
	var penyebut float64 = 1

	bagianBulat := s[:titikPos]
	bagianDesimal := s[titikPos+1:]

	if len(bagianBulat) > 0 {
		n, ok := stringKeInt(bagianBulat)
		if !ok {
			return 0, false
		}
		bulat = n
	}

	if len(bagianDesimal) > 0 {
		n, ok := stringKeInt(bagianDesimal)
		if !ok {
			return 0, false
		}
		desimal = n
		for i := 0; i < len(bagianDesimal); i++ {
			penyebut *= 10
		}
	}

	return float64(bulat) + float64(desimal)/penyebut, true
}

func bacaString(prompt string) string {
	fmt.Print(prompt)
	return trimSpasi(bacaLine())
}

func bacaFloat(prompt string) float64 {
	for {
		fmt.Print(prompt)
		input := trimSpasi(bacaLine())
		nilai, ok := stringKeFloat(input)
		if ok && nilai >= 1.0 && nilai <= 10.0 {
			return nilai
		}
		fmt.Println("  Masukkan angka antara 1.0 - 10.0!")
	}
}

func bacaInt(prompt string) int {
	for {
		fmt.Print(prompt)
		input := trimSpasi(bacaLine())
		nilai, ok := stringKeInt(input)
		if ok {
			return nilai
		}
		fmt.Println("  Masukkan angka yang valid!")
	}
}

func cariIndexByID(id int) int {
	for i, lagu := range koleksi.DaftarLagu {
		if lagu.ID == id {
			return i
		}
	}
	return -1
}

func cetakBintang(n int) {
	if n <= 0 {
		return
	}
	fmt.Print("*")
	cetakBintang(n - 1)
}

func cetakBintangString(n int) string {
	if n <= 0 {
		return ""
	}
	return "*" + cetakBintangString(n-1)
}

func tampilkanHeader() {
	fmt.Println("╔══════════════════════════════════════════════════╗")
	fmt.Println("║       APLIKASI KOLEKSI MUSIK FAVORIT             ║")
	fmt.Println("║            Kelompok 20 - ASEP                    ║")
	fmt.Println("╚══════════════════════════════════════════════════╝")
	fmt.Println()
}

func tampilkanMenu() {
	fmt.Println("┌─────────────────────────────────────────┐")
	fmt.Println("│               MENU UTAMA                │")
	fmt.Println("├─────────────────────────────────────────┤")
	fmt.Println("│  1. Tambah Lagu                         │")
	fmt.Println("│  2. Tampilkan Semua Lagu                │")
	fmt.Println("│  3. Ubah Data Lagu                      │")
	fmt.Println("│  4. Hapus Lagu                          │")
	fmt.Println("│  5. Cari Lagu (Sequential Search)       │")
	fmt.Println("│  6. Cari Lagu (Binary Search by Rating) │")
	fmt.Println("│  7. Urutkan by Rating (Selection Sort)  │")
	fmt.Println("│  8. Urutkan by Artis (Insertion Sort)   │")
	fmt.Println("│  9. Lagu Rating Tertinggi & Terendah    │")
	fmt.Println("│  10. Cetak Bintang Rating (Rekursif)    │")
	fmt.Println("│  11. Filter Lagu by Genre               │")
	fmt.Println("│  0. Keluar                              │")
	fmt.Println("└─────────────────────────────────────────┘")
	fmt.Print("  Pilih menu: ")
}

func padKanan(s string, lebar int) string {
	for len(s) < lebar {
		s += " "
	}
	return s
}

func intKeString(n int) string {
	if n == 0 {
		return "0"
	}
	negatif := false
	if n < 0 {
		negatif = true
		n = -n
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	if negatif {
		return "-" + digits
	}
	return digits
}

func tampilkanTabel(daftar []Lagu) {
	if len(daftar) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}

	lebarID := len("ID")
	lebarJudul := len("Judul")
	lebarArtis := len("Artis")
	lebarGenre := len("Genre")
	lebarRating := len("Rating  Bintang")
	for _, l := range daftar {
		if len(intKeString(l.ID)) > lebarID {
			lebarID = len(intKeString(l.ID))
		}
		if len(l.Judul) > lebarJudul {
			lebarJudul = len(l.Judul)
		}
		if len(l.Artis) > lebarArtis {
			lebarArtis = len(l.Artis)
		}
		if len(l.Genre) > lebarGenre {
			lebarGenre = len(l.Genre)
		}

		ratingCol := fmt.Sprintf("%.1f  %s", l.Rating, cetakBintangString(int(l.Rating)))
		if len(ratingCol) > lebarRating {
			lebarRating = len(ratingCol)
		}
	}

	lebarKolom := []int{lebarID, lebarJudul, lebarArtis, lebarGenre, lebarRating}

	ulangiKarakter := func(karakter string, n int) string {
		hasil := ""
		for i := 0; i < n; i++ {
			hasil += karakter
		}
		return hasil
	}

	buatGaris := func(kiri, tengah, kanan string) string {
		hasil := "  " + kiri
		for i, lebar := range lebarKolom {
			hasil += ulangiKarakter("─", lebar+2)
			if i < len(lebarKolom)-1 {
				hasil += tengah
			} else {
				hasil += kanan
			}
		}
		return hasil
	}

	fmt.Printf("\n  Total Lagu: %d\n", len(daftar))
	fmt.Println(buatGaris("┌", "┬", "┐"))
	fmt.Printf("  │ %s │ %s │ %s │ %s │ %s │\n",
		padKanan("ID", lebarID),
		padKanan("Judul", lebarJudul),
		padKanan("Artis", lebarArtis),
		padKanan("Genre", lebarGenre),
		padKanan("Rating  Bintang", lebarRating),
	)
	fmt.Println(buatGaris("├", "┼", "┤"))

	for _, l := range daftar {
		bintang := cetakBintangString(int(l.Rating))
		ratingCol := fmt.Sprintf("%.1f  %s", l.Rating, bintang)
		fmt.Printf("  │ %s │ %s │ %s │ %s │ %s │\n",
			padKanan(intKeString(l.ID), lebarID),
			padKanan(l.Judul, lebarJudul),
			padKanan(l.Artis, lebarArtis),
			padKanan(l.Genre, lebarGenre),
			padKanan(ratingCol, lebarRating),
		)
	}
	fmt.Println(buatGaris("└", "┴", "┘"))
}

func tampilkanSemuaLagu(daftar []Lagu) {
	tampilkanTabel(daftar)
}

func tampilkanLagu(l Lagu) {
	tampilkanTabel([]Lagu{l})
}

func daftarGenreUnik() []string {
	var genres []string
	for _, lagu := range koleksi.DaftarLagu {
		sudahAda := false
		for _, g := range genres {
			if toLower(g) == toLower(lagu.Genre) {
				sudahAda = true
				break
			}
		}
		if !sudahAda {
			genres = append(genres, lagu.Genre)
		}
	}
	return genres
}

func filterByGenre(genre string) []Lagu {
	var hasil []Lagu
	for _, lagu := range koleksi.DaftarLagu {
		if toLower(lagu.Genre) == toLower(genre) {
			hasil = append(hasil, lagu)
		}
	}
	return hasil
}

func menuFilterGenre() {
	fmt.Println("\n  ── FILTER LAGU BY GENRE ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}

	genres := daftarGenreUnik()
	fmt.Println("\n  Genre yang tersedia:")
	for i, g := range genres {
		fmt.Printf("  %d. %s\n", i+1, g)
	}

	genre := bacaString("\n  Masukkan genre yang ingin ditampilkan: ")
	hasil := filterByGenre(genre)

	if len(hasil) == 0 {
		fmt.Printf("\n  Tidak ada lagu dengan genre \"%s\"\n", genre)
	} else {
		fmt.Printf("\n  Lagu dengan genre \"%s\":\n", genre)
		tampilkanTabel(hasil)
	}
}

func tambahLagu() {
	fmt.Println("\n  ── TAMBAH LAGU BARU ──")
	judul := bacaString("  Judul Lagu   : ")
	artis := bacaString("  Artis        : ")
	genre := bacaString("  Genre        : ")
	rating := bacaFloat("  Rating (1-10): ")

	koleksi.IDTerakhir++
	laguBaru := Lagu{
		ID:     koleksi.IDTerakhir,
		Judul:  judul,
		Artis:  artis,
		Genre:  genre,
		Rating: rating,
	}
	koleksi.DaftarLagu = append(koleksi.DaftarLagu, laguBaru)
	fmt.Printf("\n  Lagu \"%s\" berhasil ditambahkan! (ID: %d)\n", judul, laguBaru.ID)
}

func ubahLagu() {
	fmt.Println("\n  ── UBAH DATA LAGU ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}

	id := bacaInt("  Masukkan ID Lagu yang ingin diubah: ")
	index := cariIndexByID(id)
	if index == -1 {
		fmt.Printf("  Lagu dengan ID %d tidak ditemukan!\n", id)
		return
	}

	fmt.Println("\n  Data saat ini:")
	tampilkanLagu(koleksi.DaftarLagu[index])
	fmt.Println("  Masukkan data baru (ketik '-' jika tidak ingin mengubah):")

	judul := bacaString("  Judul Baru  : ")
	if judul != "-" && judul != "" {
		koleksi.DaftarLagu[index].Judul = judul
	}

	artis := bacaString("  Artis Baru  : ")
	if artis != "-" && artis != "" {
		koleksi.DaftarLagu[index].Artis = artis
	}

	genre := bacaString("  Genre Baru  : ")
	if genre != "-" && genre != "" {
		koleksi.DaftarLagu[index].Genre = genre
	}

	ratingStr := bacaString("  Rating Baru (1-10, '-' jika tidak diubah): ")
	if ratingStr != "-" && ratingStr != "" {
		rating, ok := stringKeFloat(ratingStr)
		if ok && rating >= 1.0 && rating <= 10.0 {
			koleksi.DaftarLagu[index].Rating = rating
		} else {
			fmt.Println("  Rating tidak valid, data rating tidak diubah.")
		}
	}

	fmt.Println("\n  Data lagu berhasil diubah!")
}

func hapusLagu() {
	fmt.Println("\n  ── HAPUS LAGU ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}

	id := bacaInt("  Masukkan ID Lagu yang ingin dihapus: ")
	index := cariIndexByID(id)
	if index == -1 {
		fmt.Printf("  Lagu dengan ID %d tidak ditemukan!\n", id)
		return
	}

	judul := koleksi.DaftarLagu[index].Judul
	koleksi.DaftarLagu = append(koleksi.DaftarLagu[:index], koleksi.DaftarLagu[index+1:]...)
	fmt.Printf("\n  Lagu \"%s\" berhasil dihapus!\n", judul)
}

func sequentialSearch(keyword string) []Lagu {
	var hasil []Lagu
	kwLower := toLower(keyword)
	for _, lagu := range koleksi.DaftarLagu {
		if mengandung(toLower(lagu.Judul), kwLower) ||
			mengandung(toLower(lagu.Artis), kwLower) ||
			mengandung(toLower(lagu.Genre), kwLower) {
			hasil = append(hasil, lagu)
		}
	}
	return hasil
}

func menuCariSequential() {
	fmt.Println("\n  ── CARI LAGU (SEQUENTIAL SEARCH) ──")
	keyword := bacaString("  Masukkan kata kunci (judul/artis/genre): ")
	hasil := sequentialSearch(keyword)

	if len(hasil) == 0 {
		fmt.Printf("\n  Tidak ada lagu yang cocok dengan \"%s\"\n", keyword)
	} else {
		fmt.Printf("\n  Ditemukan %d lagu:\n", len(hasil))
		tampilkanSemuaLagu(hasil)
	}
}

func binarySearchByRating(daftar []Lagu, targetRating float64) int {
	kiri := 0
	kanan := len(daftar) - 1

	for kiri <= kanan {
		tengah := (kiri + kanan) / 2
		if daftar[tengah].Rating == targetRating {
			return tengah
		} else if daftar[tengah].Rating > targetRating {
			kiri = tengah + 1
		} else {
			kanan = tengah - 1
		}
	}
	return -1
}

func menuBinarySearch() {
	fmt.Println("\n  ── CARI LAGU (BINARY SEARCH BY RATING) ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}

	terurut := selectionSortByRating(koleksi.DaftarLagu)
	rating := bacaFloat("  Cari lagu dengan rating: ")
	index := binarySearchByRating(terurut, rating)

	if index == -1 {
		fmt.Printf("\n  Tidak ada lagu dengan rating %.1f\n", rating)
	} else {
		fmt.Printf("\n  Lagu dengan rating %.1f:\n\n", rating)
		for _, lagu := range terurut {
			if lagu.Rating == rating {
				tampilkanLagu(lagu)
			}
		}
	}
}

func selectionSortByRating(daftar []Lagu) []Lagu {
	hasil := make([]Lagu, len(daftar))
	copy(hasil, daftar)
	n := len(hasil)

	for i := 0; i < n-1; i++ {
		indexMaks := i
		for j := i + 1; j < n; j++ {
			if hasil[j].Rating > hasil[indexMaks].Rating {
				indexMaks = j
			}
		}
		if indexMaks != i {
			hasil[i], hasil[indexMaks] = hasil[indexMaks], hasil[i]
		}
	}
	return hasil
}

func menuSortRating() {
	fmt.Println("\n  ── URUTKAN BY RATING (SELECTION SORT) ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}
	terurut := selectionSortByRating(koleksi.DaftarLagu)
	fmt.Println("\n  Lagu diurutkan dari rating tertinggi:\n")
	tampilkanSemuaLagu(terurut)
}

func insertionSortByArtis(daftar []Lagu) []Lagu {
	hasil := make([]Lagu, len(daftar))
	copy(hasil, daftar)
	n := len(hasil)

	for i := 1; i < n; i++ {
		kunci := hasil[i]
		j := i - 1
		for j >= 0 && toLower(hasil[j].Artis) > toLower(kunci.Artis) {
			hasil[j+1] = hasil[j]
			j--
		}
		hasil[j+1] = kunci
	}
	return hasil
}

func menuSortArtis() {
	fmt.Println("\n  ── URUTKAN BY ARTIS (INSERTION SORT) ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}
	terurut := insertionSortByArtis(koleksi.DaftarLagu)
	fmt.Println("\n  Lagu diurutkan berdasarkan nama artis A-Z:\n")
	tampilkanSemuaLagu(terurut)
}

func cariRatingTertinggi(daftar []Lagu) Lagu {
	maks := daftar[0]
	for _, lagu := range daftar[1:] {
		if lagu.Rating > maks.Rating {
			maks = lagu
		}
	}
	return maks
}

func cariRatingTerendah(daftar []Lagu) Lagu {
	min := daftar[0]
	for _, lagu := range daftar[1:] {
		if lagu.Rating < min.Rating {
			min = lagu
		}
	}
	return min
}

func menuNilaiEkstrem() {
	fmt.Println("\n  ── LAGU RATING TERTINGGI & TERENDAH ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}
	tertinggi := cariRatingTertinggi(koleksi.DaftarLagu)
	terendah := cariRatingTerendah(koleksi.DaftarLagu)

	fmt.Println("\n  Lagu dengan Rating TERTINGGI:")
	tampilkanLagu(tertinggi)
	fmt.Println("  Lagu dengan Rating TERENDAH:")
	tampilkanLagu(terendah)
}

func menuCetakBintang() {
	fmt.Println("\n  ── CETAK BINTANG RATING (REKURSIF) ──")
	if len(koleksi.DaftarLagu) == 0 {
		fmt.Println("  Koleksi lagu masih kosong!")
		return
	}
	for _, lagu := range koleksi.DaftarLagu {
		fmt.Printf("  %s - %s\n  Rating: ", lagu.Judul, lagu.Artis)
		cetakBintang(int(lagu.Rating))
		fmt.Printf(" (%.1f/10)\n\n", lagu.Rating)
	}
}

func isiDataContoh() {
	type DataContoh struct {
		judul, artis, genre string
		rating              float64
	}

	contoh := []DataContoh{
		{"BohemianRhapsody", "Queen", "Rock", 9.5},
		{"ShapeOfYou", "EdSheeran", "Pop", 8.2},
		{"BlindingLights", "TheWeeknd", "Synthpop", 9.0},
		{"StayWithMe", "SamSmith", "Soul", 7.8},
		{"Levitating", "DuaLipa", "Pop", 8.5},
		{"HotelCalifornia", "Eagles", "Rock", 9.3},
		{"AsItWas", "HarryStyles", "IndiePop", 7.5},
		{"BadGuy", "BillieEilish", "Electropop", 8.8},
	}

	for _, c := range contoh {
		koleksi.IDTerakhir++
		koleksi.DaftarLagu = append(koleksi.DaftarLagu, Lagu{
			ID:     koleksi.IDTerakhir,
			Judul:  c.judul,
			Artis:  c.artis,
			Genre:  c.genre,
			Rating: c.rating,
		})
	}
	fmt.Println("  Data contoh berhasil dimuat (8 lagu)!")
}

func main() {
	tampilkanHeader()

	fmt.Print("  Muat data contoh dulu? (y/n): ")
	jawab := trimSpasi(bacaLine())
	if toLower(jawab) == "y" {
		isiDataContoh()
	}

	for {
		fmt.Println()
		tampilkanMenu()

		pilihan := trimSpasi(bacaLine())
		fmt.Println()

		switch pilihan {
		case "1":
			tambahLagu()
		case "2":
			fmt.Println("  ── SEMUA LAGU ──")
			tampilkanSemuaLagu(koleksi.DaftarLagu)
		case "3":
			ubahLagu()
		case "4":
			hapusLagu()
		case "5":
			menuCariSequential()
		case "6":
			menuBinarySearch()
		case "7":
			menuSortRating()
		case "8":
			menuSortArtis()
		case "9":
			menuNilaiEkstrem()
		case "10":
			menuCetakBintang()
		case "11":
			menuFilterGenre()
		case "0":
			fmt.Println("  Terima kasih! Sampai jumpa!")
			fmt.Println("  Program dibuat oleh Kelompok 20 - ASEP")
			return
		default:
			fmt.Println("  Pilihan tidak valid! Silakan pilih 0-11.")
		}

		fmt.Print("\n  Tekan ENTER untuk kembali ke menu...")
		bacaLine()
	}
}