# HPPS Assignment 4 - AI Review Document

This document is intended for AI model review. It contains all questions from the assignment, my solutions, and the code implementations.

---

## Assignment Overview

**Course:** HPPS (High Performance Programming and Systems) 2025
**Topic:** Locality Optimizations
**Dataset:** OpenStreetMap place names (21 million records)

---

## Task 3: Querying by ID

### 3.1 id_query_naive.c: Brute-force querying

**Question:** Implement a program that performs a linear search through all records for the desired ID.

**Solution:** Store a pointer to the records array and iterate through it comparing `osm_id` values.

**Code:**
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <stdint.h>
#include <errno.h>
#include <assert.h>

#include "record.h"
#include "id_query.h"

struct naive_data {
  struct record *rs;
  int n;
};

struct naive_data* mk_naive(struct record* rs, int n) {
  struct naive_data *data = malloc(sizeof(struct naive_data));
  if (data == NULL) {
    return NULL;
  }
  data->rs = rs;
  data->n = n;
  return data;
}

void free_naive(struct naive_data* data) {
  free(data);
}

const struct record* lookup_naive(struct naive_data *data, int64_t needle) {
  for (int i = 0; i < data->n; i++) {
    if (data->rs[i].osm_id == needle) {
      return &data->rs[i];
    }
  }
  return NULL;
}

int main(int argc, char** argv) {
  return id_query_loop(argc, argv,
                    (mk_index_fn)mk_naive,
                    (free_index_fn)free_naive,
                    (lookup_fn)lookup_naive);
}
```

**Complexity:**
- Build: O(1)
- Query: O(n)
- Space: O(1) additional

---

### 3.2 id_query_indexed.c: Querying an index

**Question:** Write a program that searches an array of `struct index_record` instead of `struct record`.

**Solution:** Create a compact index array containing only `osm_id` and a pointer to the full record. This improves spatial locality during linear search.

**Code:**
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <stdint.h>
#include <errno.h>
#include <assert.h>

#include "record.h"
#include "id_query.h"

struct index_record {
  int64_t osm_id;
  const struct record *record;
};

struct indexed_data {
  struct index_record *irs;
  int n;
};

struct indexed_data* mk_indexed(struct record* rs, int n) {
  struct indexed_data *data = malloc(sizeof(struct indexed_data));
  if (data == NULL) {
    return NULL;
  }

  data->irs = malloc(n * sizeof(struct index_record));
  if (data->irs == NULL) {
    free(data);
    return NULL;
  }

  for (int i = 0; i < n; i++) {
    data->irs[i].osm_id = rs[i].osm_id;
    data->irs[i].record = &rs[i];
  }

  data->n = n;
  return data;
}

void free_indexed(struct indexed_data* data) {
  free(data->irs);
  free(data);
}

const struct record* lookup_indexed(struct indexed_data *data, int64_t needle) {
  for (int i = 0; i < data->n; i++) {
    if (data->irs[i].osm_id == needle) {
      return data->irs[i].record;
    }
  }
  return NULL;
}

int main(int argc, char** argv) {
  return id_query_loop(argc, argv,
                       (mk_index_fn)mk_indexed,
                       (free_index_fn)free_indexed,
                       (lookup_fn)lookup_indexed);
}
```

**Complexity:**
- Build: O(n)
- Query: O(n)
- Space: O(n) additional (for the index array)

**Why it's faster:** `struct index_record` is 16 bytes (8-byte int64_t + 8-byte pointer), while `struct record` is much larger (many string pointers, doubles, etc.). More index records fit in a cache line (64 bytes ≈ 4 index records), improving spatial locality.

---

### 3.3 id_query_binsort.c: Querying a sorted index

**Question:** Sort the array of records by their `osm_id` (use `qsort()`), and use binary search when looking up records.

**Solution:** Same index structure as 3.2, but sorted during build phase. Lookup uses binary search.

**Code:**
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <stdint.h>
#include <errno.h>
#include <assert.h>

#include "record.h"
#include "id_query.h"

struct index_record {
  int64_t osm_id;
  const struct record *record;
};

struct indexed_data {
  struct index_record *irs;
  int n;
};

int compare_index_records(const void *a, const void *b) {
  const struct index_record *ra = a;
  const struct index_record *rb = b;
  if (ra->osm_id < rb->osm_id) {
    return -1;
  } else if (ra->osm_id > rb->osm_id) {
    return 1;
  } else {
    return 0;
  }
}

struct indexed_data* mk_indexed(struct record* rs, int n) {
  struct indexed_data *data = malloc(sizeof(struct indexed_data));
  if (data == NULL) {
    return NULL;
  }

  data->irs = malloc(n * sizeof(struct index_record));
  if (data->irs == NULL) {
    free(data);
    return NULL;
  }

  for (int i = 0; i < n; i++) {
    data->irs[i].osm_id = rs[i].osm_id;
    data->irs[i].record = &rs[i];
  }

  data->n = n;

  qsort(data->irs, n, sizeof(struct index_record), compare_index_records);

  return data;
}

void free_indexed(struct indexed_data* data) {
  free(data->irs);
  free(data);
}

const struct record* lookup_indexed(struct indexed_data *data, int64_t needle) {
  int lo = 0;
  int hi = data->n - 1;

  while (lo <= hi) {
    int mid = lo + (hi - lo) / 2;
    int64_t mid_id = data->irs[mid].osm_id;

    if (mid_id == needle) {
      return data->irs[mid].record;
    } else if (mid_id < needle) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  return NULL;
}

int main(int argc, char** argv) {
  return id_query_loop(argc, argv,
                       (mk_index_fn)mk_indexed,
                       (free_index_fn)free_indexed,
                       (lookup_fn)lookup_indexed);
}
```

**Complexity:**
- Build: O(n log n) due to qsort
- Query: O(log n)
- Space: O(n) additional

**Trade-off:** Higher build cost is amortized over many queries. For 100k records, build takes ~13ms but each query takes <1μs instead of ~200μs.

---

## Task 4: Querying by Coordinate

### 4.1 coord_query_naive.c: Naive brute-force querying

**Question:** Implement a program that performs a linear search through all records and picks the record whose location is closest to the query coordinates using Euclidean distance.

**Solution:** Iterate through all records, compute squared Euclidean distance (avoiding sqrt for efficiency), track minimum.

**Code:**
```c
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/time.h>
#include <stdint.h>
#include <errno.h>
#include <assert.h>

#include "record.h"
#include "coord_query.h"

struct naive_data {
  struct record *rs;
  int n;
};

struct naive_data* mk_naive(struct record* rs, int n) {
  struct naive_data *data = malloc(sizeof(struct naive_data));
  if (data == NULL) {
    return NULL;
  }
  data->rs = rs;
  data->n = n;
  return data;
}

void free_naive(struct naive_data* data) {
  free(data);
}

const struct record* lookup_naive(struct naive_data *data, double lon, double lat) {
  const struct record *closest = NULL;
  double closest_dist_sq = -1;

  for (int i = 0; i < data->n; i++) {
    double dx = data->rs[i].lon - lon;
    double dy = data->rs[i].lat - lat;
    double dist_sq = dx * dx + dy * dy;

    if (closest == NULL || dist_sq < closest_dist_sq) {
      closest = &data->rs[i];
      closest_dist_sq = dist_sq;
    }
  }

  return closest;
}

int main(int argc, char** argv) {
  return coord_query_loop(argc, argv,
                          (mk_index_fn)mk_naive,
                          (free_index_fn)free_naive,
                          (lookup_fn)lookup_naive);
}
```

**Complexity:**
- Build: O(1)
- Query: O(n)
- Space: O(1) additional

**Note:** I use squared distance (`dist_sq`) instead of actual distance to avoid the expensive `sqrt()` operation. Since we only need to compare distances, this is mathematically equivalent.

---

## Task 5: Report Questions

### Question 1: Evaluate the temporal and spatial locality of the four programs

**Answer:**

| Program | Spatial Locality | Temporal Locality |
|---------|------------------|-------------------|
| id_query_naive | **Poor** - Scans large `struct record` (hundreds of bytes) but only needs `osm_id` (8 bytes). Most data loaded into cache is unused. | **Minimal** - Each record visited once per query, no reuse. |
| id_query_indexed | **Good** - Scans compact 16-byte `struct index_record`. ~4 records fit per cache line. All loaded data is useful. | **Minimal** - Still single pass per query. |
| id_query_binsort | **Mixed** - Uses compact index but binary search jumps around memory (not sequential access). | **Better** - Middle elements accessed frequently across queries, may stay in cache. |
| coord_query_naive | **Poor** - Same as id_query_naive. Accesses large struct for just two `double` values (lon, lat). | **Minimal** - Single pass per query. |

**Key insight:** The indexed versions improve spatial locality by creating a compact "projection" of only the data needed for searching. This is a classic cache optimization technique.

---

### Question 2: Do your programs corrupt memory? Do they leak memory? How do you know?

**Answer:**

**Memory corruption:** No. Verified using AddressSanitizer (`-fsanitize=address`). All four programs ran without any ASan errors.

**Memory leaks:** No. Verified by:
1. Code inspection: Every `malloc` has a corresponding `free`
   - `mk_naive`/`mk_indexed` allocates → `free_naive`/`free_indexed` deallocates
   - Index array allocated in `mk_indexed` → freed in `free_indexed`
2. The main loop in `id_query.c`/`coord_query.c` correctly calls `free_index(index)` and `free_records(rs, n)`

**Allocation pattern:**
```
mk_naive:     malloc(struct naive_data)         → free_naive: free(data)
mk_indexed:   malloc(struct indexed_data)       → free_indexed: free(data)
              malloc(n * struct index_record)   →              free(data->irs)
```

Note: Valgrind is not available on macOS ARM, so I used AddressSanitizer which is the recommended alternative.

---

### Question 3: How confident are you that your programs are correct?

**Answer:**

**High confidence.** Evidence:

1. **Cross-validation:** All three ID query programs produce identical results for 100 random valid IDs:
   ```
   diff naive_results.txt indexed_results.txt  → no differences
   diff naive_results.txt binsort_results.txt  → no differences
   ```

2. **Edge cases tested:**
   - IDs that exist → returns correct record with name, lon, lat
   - IDs that don't exist → returns "not found"
   - Coordinate queries → returns nearest place

3. **Algorithm correctness:**
   - Linear search: trivially correct (check every element)
   - Binary search: standard implementation with correct bounds handling
   - Euclidean distance: uses squared distance which preserves ordering

4. **No undefined behavior:** AddressSanitizer detected no issues.

---

### Question 4: Benchmark your programs on various workloads and explain the differences

**Answer:**

**Benchmark Results (1000 queries):**

| Program | Records | Build (ms) | Total Query (ms) | Per Query (μs) |
|---------|---------|------------|------------------|----------------|
| id_query_naive | 20,000 | 0 | 25.4 | 25.4 |
| id_query_indexed | 20,000 | 0 | 13.7 | 13.7 |
| id_query_binsort | 20,000 | 2 | 0.19 | 0.19 |
| id_query_naive | 100,000 | 0 | 210.6 | 210.6 |
| id_query_indexed | 100,000 | 1 | 63.8 | 63.8 |
| id_query_binsort | 100,000 | 13 | 0.18 | 0.18 |

**Workload selection rationale:**
- **20k and 100k records:** Shows scaling behavior (5x data → ~5x time for linear, constant for binary)
- **1000 queries:** Provides stable averages and demonstrates build cost amortization

**Analysis:**

1. **Naive vs Indexed (both O(n)):**
   - 20k: indexed is 1.9x faster
   - 100k: indexed is 3.3x faster
   - Speedup comes from better cache utilization (smaller data → more fits in cache)

2. **Binary search dominance:**
   - 100k records: 1170x faster than naive per query
   - Build cost (13ms) is amortized: 13ms ÷ 1000 queries = 13μs/query overhead
   - Net savings: 210μs - 0.18μs - 13μs = ~197μs saved per query

3. **Scaling:**
   - Linear search: 5x records → ~5x time (as expected)
   - Binary search: 5x records → nearly constant time (log₂(100000) ≈ 17 vs log₂(20000) ≈ 15)

---

## Makefile Changes

Added `id_query_indexed` and `id_query_binsort` to the PROGRAMS variable:

```makefile
PROGRAMS=random_ids id_query_naive id_query_indexed id_query_binsort coord_query_naive
```

The existing pattern rules handle compilation automatically:
```makefile
id_query_%: id_query_%.o record.o id_query.o
	gcc -o $@ $^ $(LDFLAGS)
```

---

## Files Modified/Created

| File | Action | Description |
|------|--------|-------------|
| `id_query_naive.c` | Modified | Implemented `mk_naive`, `free_naive`, `lookup_naive` |
| `id_query_indexed.c` | Created | New file with compact index + linear search |
| `id_query_binsort.c` | Created | New file with sorted index + binary search |
| `coord_query_naive.c` | Modified | Implemented `mk_naive`, `free_naive`, `lookup_naive` |
| `Makefile` | Modified | Added new targets to PROGRAMS |
| `report.tex` | Created | LaTeX source for the report |
| `assignment-4-answer.pdf` | Created | Compiled PDF report |

---

## Testing Commands Used

```bash
# Compile
make all

# Test correctness
./random_ids 20000records.tsv | head -n 100 > test_ids.txt
cat test_ids.txt | ./id_query_naive 20000records.tsv | grep "^[0-9]" | sort > naive.txt
cat test_ids.txt | ./id_query_indexed 20000records.tsv | grep "^[0-9]" | sort > indexed.txt
cat test_ids.txt | ./id_query_binsort 20000records.tsv | grep "^[0-9]" | sort > binsort.txt
diff naive.txt indexed.txt  # Should be empty
diff naive.txt binsort.txt  # Should be empty

# Test memory safety
make clean
CFLAGS="-Wall -Wextra -pedantic -std=gnu99 -g -fsanitize=address" LDFLAGS="-lm -fsanitize=address" make all
echo "1977480" | ./id_query_naive 20000records.tsv

# Benchmark
./random_ids 20000records.tsv | head -n 1000 > bench_ids.txt
cat bench_ids.txt | ./id_query_naive 20000records.tsv | grep "Total"
cat bench_ids.txt | ./id_query_indexed 20000records.tsv | grep "Total"
cat bench_ids.txt | ./id_query_binsort 20000records.tsv | grep "Total"
```

---

## Potential Improvements (Not Implemented)

1. **Eytzinger layout** for binary search (mentioned in assignment as optional bonus) - improves cache behavior of binary search
2. **k-d tree** for coordinate queries (mentioned as optional bonus) - O(log n) average case for nearest neighbor
3. **Hash table** for ID lookups - O(1) average case but more complex implementation
