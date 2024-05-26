    curl -G "http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/filter" \
        --data-urlencode "filterType=AND" \
        --data-urlencode "keyword=ammi" \
        --data-urlencode "category=asdf" \
        --data-urlencode "creatorName=asdfsdf"
curl "http://bkyz2-fmaaa-aaaaa-qaaaq-cai.localhost:8000/courses/filter?filterType=AND&keyword=ammi&category=asdf&creatorName=asdfsdf"
