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
